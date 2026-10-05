from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .identity import identity_columns
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
        fields = ["id", "schema_name", "name", "unp", "call_legal", "is_active", "created_at", "updated_at"]
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
            "phone", "position", "role", "contour", "organization", "service_organizations", "is_active", "last_login",
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
    supplier_name = serializers.SerializerMethodField()
    show_schema = serializers.SerializerMethodField()
    show_supplier = serializers.SerializerMethodField()
    show_service_org = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "display_name", "email", "role", "contour", "organization",
            "organization_name", "supplier_name", "show_schema", "show_supplier", "show_service_org",
        ]

    def _columns(self, obj) -> dict[str, bool]:
        cached = getattr(self, "_identity_columns", None)
        if cached is None or cached[0] != obj.pk:
            self._identity_columns = (obj.pk, identity_columns(obj))
        return self._identity_columns[1]

    def get_show_schema(self, obj) -> bool:
        return self._columns(obj)["show_schema"]

    def get_show_supplier(self, obj) -> bool:
        return self._columns(obj)["show_supplier"]

    def get_show_service_org(self, obj) -> bool:
        return self._columns(obj)["show_service_org"]

    def get_supplier_name(self, obj) -> str:
        if getattr(obj, "contour", "") != User.Contour.SUPPLIER:
            return ""
        names = list(obj.service_organizations.order_by("short_name").values_list("short_name", flat=True))
        if len(names) == 1:
            return names[0]
        return ""
