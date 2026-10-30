from django.urls import path
from rest_framework.routers import DefaultRouter

from .board_widths import BoardWidthView
from .claims_views import ClaimCaseViewSet
from .ie_sign_views import IeSignPdfView, IeSignSessionView, IeSignSubmitView, IeSignTicketView
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
router.register("claims", ClaimCaseViewSet, basename="claim")
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

urlpatterns = [
    path("board-widths/<slug:board>/", BoardWidthView.as_view(), name="board-widths"),
    path("claims/<int:pk>/ie-sign-ticket/", IeSignTicketView.as_view(), name="claim-ie-sign-ticket"),
    path("ie-sign/<str:token>/", IeSignSessionView.as_view(), name="ie-sign-session"),
    path("ie-sign/<str:token>/sign/", IeSignSubmitView.as_view(), name="ie-sign-submit"),
    path(
        "ie-sign/<str:token>/documents/<int:doc_id>/pdf/",
        IeSignPdfView.as_view(),
        name="ie-sign-pdf",
    ),
    *router.urls,
]
