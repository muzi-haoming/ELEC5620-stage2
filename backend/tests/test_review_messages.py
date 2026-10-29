import pytest
from app.review_messages import review_status, MESSAGES
from app.main import result_view

@pytest.mark.parametrize('mode,expected',[
 ('input_validation','input_invalid'),
 ('model_unavailable:input_tokens_too_large','review_input_limit'),
 ('campus-qwen','photo_rejected'),
 ('explicit_demo_photos','photo_rejected'),
 ('model_unavailable:OpenAIRateLimitError:HTTP429','review_busy'),
 ('model_unavailable:APITimeoutError','review_timeout'),
 ('model_unavailable:APIConnectionError','review_unavailable'),
 ('model_unavailable:AuthenticationError:HTTP401','review_unavailable'),
 ('model_unavailable:InternalServerError:HTTP500','review_unavailable'),
 ('model_unavailable:ValidationError','review_unavailable'),
])
def test_review_failures_have_distinct_public_messages(mode,expected):
    assessment={'mode':mode,'errors':{'front':'Internal error'}}
    assert review_status(assessment)==expected
    raw={'assessment':assessment,'errors':dict(assessment['errors']),'screenReason':'Internal error'}
    public=result_view(raw,'seller')
    assert public['reviewStatus']==expected
    assert 'assessment' not in public
    if expected in MESSAGES:assert public['errors']['front']==MESSAGES[expected]
    assert result_view(raw,'manager')==raw

def test_missing_fields_are_not_photo_policy_violations():
    errors={'name':'请填写有效内容（2–80 字符）','front':'请上传正面照片'}
    result=result_view({'assessment':{'mode':'input_validation','errors':errors},'errors':errors},'seller')
    assert result['reviewStatus']=='input_invalid'
    assert result['errors']==errors


def test_provider_input_limit_is_not_retryable_rate_limit():
    from app.agents import model_error_summary
    class UpstreamError(Exception):
        status_code=429
        body={'code':'input_tokens_too_large','message':'Input token limit exceeded'}
    assert model_error_summary(UpstreamError())=='input_tokens_too_large'


def test_inference_copy_is_compact_and_original_is_preserved(tmp_path):
    from PIL import Image
    from app.agents import model_image
    import base64,io
    path=tmp_path/'photo.png'
    Image.new('RGB',(1200,900),'green').save(path)
    original=path.read_bytes()
    encoded=model_image(path)['image_url']['url'].split(',',1)[1]
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as preview:
        assert max(preview.size)<=256
    assert path.read_bytes()==original
