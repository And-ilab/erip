import os

from django.core.management.base import BaseCommand

from apps.users.models import User


class Command(BaseCommand):
    help = "Создаёт суперадминистратора из DJANGO_SUPERUSER_* при первом запуске"

    def handle(self, *args, **options):
        username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")
        if not username or not password:
            self.stdout.write("DJANGO_SUPERUSER_* не заданы — пропуск")
            return
        if User.objects.filter(username=username).exists():
            self.stdout.write(f"Пользователь {username} уже существует")
            return
        User.objects.create_superuser(username, os.environ.get("DJANGO_SUPERUSER_EMAIL", ""), password)
        self.stdout.write(self.style.SUCCESS(f"Создан суперадминистратор {username}"))
