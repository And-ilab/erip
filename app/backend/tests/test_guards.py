import pytest
from django.core.exceptions import ImproperlyConfigured

from config.settings.guards import assert_production_safe


def test_production_rejects_example_secrets():
    with pytest.raises(ImproperlyConfigured):
        assert_production_safe("change-me", "change-me-internal", ["*"], "admin")


def test_production_accepts_real_secrets():
    assert_production_safe("x" * 40, "internal-token-not-from-example", ["erip.example"], "")
