from django.contrib import admin
from django.urls import include, path

api_v1 = [
    path("auth/", include("apps.users.auth_urls")),
    path("", include("apps.users.urls")),
    path("", include("apps.debts.urls")),
    path("nsi/", include("apps.nsi.urls")),
    path("", include("apps.imports.urls")),
    path("", include("apps.notifications.urls")),
    path("audit/", include("apps.audit.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
]
