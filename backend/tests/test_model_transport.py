import base64
import io
from types import SimpleNamespace
import pytest
from PIL import Image
from app import agents, config


def test_inference_image_is_small_and_original_is_unchanged(tmp_path):
    source = tmp_path / 'large.png'
    Image.new('RGB', (2500, 1800), 'green').save(source)
    original = source.read_bytes()
    result = agents.model_image(source)
    with Image.open(io.BytesIO(base64.b64decode(result['image_url']['url'].split(',')[1]))) as image:
        assert max(image.size) <= config.MODEL_IMAGE_MAX_EDGE
        assert image.format == 'JPEG'
    assert source.read_bytes() == original


def test_truncated_output_has_specific_failure(monkeypatch):
    monkeypatch.setattr(config, 'MODEL_API_KEY', 'test-only')
    monkeypatch.setattr(agents, 'ChatOpenAI', lambda **kwargs: SimpleNamespace(invoke=lambda messages: SimpleNamespace(content='{', response_metadata={'finish_reason': 'length'})))
    with pytest.raises(agents.ModelOutputTruncated):
        agents.structured_model(agents.Preferences, 'test', 'test')


def test_complete_structured_output_validated(monkeypatch):
    monkeypatch.setattr(config, 'MODEL_API_KEY', 'test-only')
    monkeypatch.setattr(agents, 'ChatOpenAI', lambda **kwargs: SimpleNamespace(invoke=lambda messages: SimpleNamespace(content='{"tags": []}', response_metadata={'finish_reason': 'stop'})))
    assert agents.structured_model(agents.Preferences, 'test', 'test').tags == []
