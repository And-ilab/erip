from django.urls import path

from .auth import CookieTokenObtainPairView, CookieTokenRefreshView, LogoutView, PasswordChangeView, StubRoleLoginView
from .views import MeView

urlpatterns = [
    path("token/", CookieTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("stub-role/", StubRoleLoginView.as_view(), name="stub_role_login"),
    path("token/refresh/", CookieTokenRefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("password/", PasswordChangeView.as_view(), name="password_change"),
    path("me/", MeView.as_view(), name="me"),
]
