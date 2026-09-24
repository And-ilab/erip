from rest_framework.routers import DefaultRouter

from .views import AccountServiceViewSet, AccountViewSet, PaymentViewSet, RegistrationViewSet

router = DefaultRouter()
router.register("accounts", AccountViewSet, basename="account")
router.register("services", AccountServiceViewSet, basename="accountservice")
router.register("payments", PaymentViewSet, basename="payment")
router.register("registrations", RegistrationViewSet, basename="registration")

urlpatterns = router.urls
