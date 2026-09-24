from rest_framework.routers import DefaultRouter

from .views import MessageTemplateViewSet, NotificationViewSet

router = DefaultRouter()
router.register("templates", MessageTemplateViewSet, basename="messagetemplate")
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = router.urls
