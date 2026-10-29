from rest_framework.routers import SimpleRouter

from .integration_views import IntegrationViewSet

router = SimpleRouter()
router.register("", IntegrationViewSet, basename="integrations")

urlpatterns = router.urls
