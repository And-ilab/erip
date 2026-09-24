from rest_framework.routers import DefaultRouter

from .views import NSI_REGISTRY

router = DefaultRouter()
for prefix, viewset in NSI_REGISTRY.items():
    router.register(prefix, viewset, basename=f"nsi-{prefix}")

urlpatterns = router.urls
