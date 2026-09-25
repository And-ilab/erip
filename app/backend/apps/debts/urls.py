from rest_framework.routers import DefaultRouter

from .views import (
    AccountServiceViewSet,
    AccountViewSet,
    AttachmentViewSet,
    ContactViewSet,
    ContractViewSet,
    DebtWorkItemViewSet,
    MeasureViewSet,
    PaymentViewSet,
    RegistrationViewSet,
    SavedFilterViewSet,
)

router = DefaultRouter()
router.register("accounts", AccountViewSet, basename="account")
router.register("services", AccountServiceViewSet, basename="accountservice")
router.register("contracts", ContractViewSet, basename="contract")
router.register("payments", PaymentViewSet, basename="payment")
router.register("registrations", RegistrationViewSet, basename="registration")
router.register("contacts", ContactViewSet, basename="contact")
router.register("work-items", DebtWorkItemViewSet, basename="workitem")
router.register("attachments", AttachmentViewSet, basename="attachment")
router.register("measures", MeasureViewSet, basename="measure")
router.register("saved-filters", SavedFilterViewSet, basename="savedfilter")

urlpatterns = router.urls
