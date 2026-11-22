from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def health_view(request):
    return JsonResponse({"status": "ok", "service": "django-backend"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_view, name="api-health"),
    path("api/", include("sensors.urls")),
]
