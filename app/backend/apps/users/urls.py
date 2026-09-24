from rest_framework.routers import DefaultRouter

from .views import OrganizationViewSet, ServiceOrganizationViewSet, UserViewSet

router = DefaultRouter()
router.register("organizations", OrganizationViewSet, basename="organization")
router.register("service-organizations", ServiceOrganizationViewSet, basename="serviceorganization")
router.register("users", UserViewSet, basename="user")

urlpatterns = router.urls
