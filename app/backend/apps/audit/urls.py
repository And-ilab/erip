from rest_framework.routers import DefaultRouter

from .views import AuditLogViewSet, ErrorLogViewSet

router = DefaultRouter()
router.register("errors", ErrorLogViewSet, basename="errorlog")
router.register("actions", AuditLogViewSet, basename="auditlog")

urlpatterns = router.urls
