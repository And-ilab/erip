from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Organization, ServiceOrganization, User

ROLE_RANK = {
    User.Role.OBSERVER: 1,
    User.Role.SPECIALIST: 2,
    User.Role.LOCAL_ADMIN: 3,
    User.Role.SUPERADMIN: 4,
}


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "schema_name", "name", "unp", "is_active", "created_at", "updated_at"]
        read_only_fields = ["is_active", "created_at", "updated_at"]


class ServiceOrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceOrganization
        fields = ["id", "organization", "provider_id", "short_name", "full_name", "is_supplier", "is_active"]
        read_only_fields = ["is_active"]


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, validators=[validate_password])
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "username", "password", "first_name", "middle_name", "last_name", "display_name", "email",
            "phone", "position", "role", "organization", "service_organizations", "is_active", "last_login",
        ]
        read_only_fields = ["last_login"]

    def validate(self, attrs):
        request = self.context["request"]
        actor = request.user
        if not actor.is_superadmin:
            attrs["organization"] = actor.organization
            target_role = attrs.get("role", getattr(self.instance, "role", User.Role.SPECIALIST))
            if ROLE_RANK[target_role] >= ROLE_RANK[actor.role]:
                raise serializers.ValidationError({"role": "Нельзя назначить роль не ниже своей"})
            if self.instance is not None and self.instance.pk != actor.pk and ROLE_RANK[self.instance.role] >= ROLE_RANK[actor.role]:
                raise serializers.ValidationError("Нельзя изменять пользователя с такой же или более высокой ролью")
            if self.instance is not None and self.instance.pk == actor.pk and target_role != self.instance.role:
                raise serializers.ValidationError({"role": "Нельзя менять собственную роль"})
        organization = attrs.get("organization") or getattr(self.instance, "organization", None)
        for so in attrs.get("service_organizations", []):
            if organization is None or so.organization_id != organization.pk:
                raise serializers.ValidationError({"service_organizations": "Организация не из схемы пользователя"})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        service_orgs = validated_data.pop("service_organizations", [])
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        user.service_organizations.set(service_orgs)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


class MeSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    organization_name = serializers.CharField(source="organization.name", default=None, read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "display_name", "email", "role", "organization", "organization_name"]
