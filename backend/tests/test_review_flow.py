"""Review-before-pricing listing flow, lenient photo review, review reuse and streamed progress."""
from copy import deepcopy
import io
import json
import uuid
from PIL import Image
from app import database as db, config
from test_platform import call, ok, scripted_model


def seller_form(client=None, upload=False):
    form = deepcopy(db.seed()['items'][0])
    form['contact'] = 'seller@example.test'
    if upload:
        image = io.BytesIO(); Image.new('RGB', (32, 32), 'green').save(image, 'JPEG')
        uploaded = client.post('/api/media', files={'file': ('t.jpg', image.getvalue(), 'image/jpeg')},
                               headers={'X-Demo-Role': 'seller'}).json()
        form['photos'] = {k: uploaded for k in ['front', 'top', 'side']}
        form['photos']['details'] = []
    return form


def test_review_only_does_not_publish_and_ignores_price(client):
    form = seller_form()
    form['price'] = None
    before = len(db.snapshot()['items'])
    result = ok(call(client, 'review', {'form': form}, 'seller'))
    assert result['approved'] is True and result['errors'] == {}
    assert 'assessment' not in result
    assert len(db.snapshot()['items']) == before


def test_review_reports_missing_fields(client):
    form = seller_form()
    form['contact'] = 'bad'
    result = ok(call(client, 'review', {'form': form}, 'seller'))
    assert result['approved'] is False and 'contact' in result['errors']


def test_lenient_review_warns_then_listing_reuses_review(client, monkeypatch):
    from app.agents import VisualAssessment
    form = seller_form(client, upload=True)
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    vision_calls = []
    def assessment():
        vision_calls.append(1)
        return VisualAssessment(approved=False, depicts_real_furniture=True, category_match=True,
                                directions_match=False, description_match=True, clear_and_relevant=False,
                                reasons=['angles'])
    monkeypatch.setattr('app.agents.structured_model', scripted_model(assessment))
    reviewed = ok(call(client, 'review', {'form': form}, 'seller'))
    assert reviewed['approved'] is True and len(reviewed['warnings']) == 2
    published = ok(call(client, 'listing', {'form': form}, 'seller'))
    assert published['status'] == 'published'
    assert len(vision_calls) == 1, 'unchanged photos must not be re-sent to the vision model'


def test_non_furniture_is_still_rejected(client, monkeypatch):
    from app.agents import VisualAssessment
    form = seller_form(client, upload=True)
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    monkeypatch.setattr('app.agents.structured_model', scripted_model(lambda: VisualAssessment(
        approved=False, depicts_real_furniture=False, category_match=False, directions_match=False,
        description_match=False, clear_and_relevant=False, reasons=['cartoon'])))
    result = ok(call(client, 'review', {'form': form}, 'seller'))
    assert result['approved'] is False and result['status'] == 'photo_rejected'
    # No reviewer text from the model: the fixed human-style fallback is shown.
    assert result['feedback']['reason'] and result['feedback']['suggestion']
    assert result['errors']['front'].startswith(result['feedback']['reason'])


def test_category_mismatch_is_only_a_tip(client, monkeypatch):
    from app.agents import VisualAssessment
    form = seller_form(client, upload=True)
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    monkeypatch.setattr('app.agents.structured_model', scripted_model(lambda: VisualAssessment(
        approved=True, depicts_real_furniture=True, category_match=False, directions_match=True,
        description_match=True, clear_and_relevant=True)))
    result = ok(call(client, 'review', {'form': form}, 'seller'))
    assert result['approved'] is True and any('类别' in w for w in result['warnings'])


def test_streaming_action_reports_progress_then_result(client):
    form = seller_form()
    response = client.post('/api/actions', json={'operation': 'review', 'payload': {'form': form}, 'requestId': str(uuid.uuid4())},
                           headers={'X-Demo-Role': 'seller', 'Accept': 'application/x-ndjson'})
    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert any(e['type'] == 'progress' for e in events)
    assert events[-1]['type'] == 'result' and events[-1]['result']['approved'] is True
    assert all('assessment' not in json.dumps(e.get('label', '')) for e in events)


def test_streaming_action_reports_business_errors(client):
    response = client.post('/api/actions', json={'operation': 'advance', 'payload': {'orderId': 'NOPE', 'action': 'pickup'}, 'requestId': str(uuid.uuid4())},
                           headers={'X-Demo-Role': 'seller', 'Accept': 'application/x-ndjson'})
    events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert events[-1]['type'] == 'error' and events[-1]['status'] in (404, 409)
