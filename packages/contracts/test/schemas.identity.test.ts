import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';

import {
  accessAssignmentResponseSchema,
  accessAssignmentScopeOptionsResponseSchema,
  accessGroupMemberListResponseSchema,
  accessGroupResponseSchema,
  accessRoleResponseSchema,
  activateResponseSchema,
  configureSsoOidcProviderRequestSchema,
  createAccessAssignmentRequestSchema,
  deleteSsoOidcProviderResponseSchema,
  inviteUserRequestSchema,
  inviteUserResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  loginStateResponseSchema,
  organizationUserResponseSchema,
  removeUserResponseSchema,
  updateSsoOidcProviderRequestSchema,
  whoamiQuerySchema,
  type ActivateResponse,
  type AccessAssignmentResponse,
  type AccessAssignmentScopeOptionsResponse,
  type AccessGroupMemberListResponse,
  type AccessGroupResponse,
  type AccessRoleResponse,
  type ConfigureSsoOidcProviderRequest,
  type DeleteSsoOidcProviderResponse,
  type InviteUserRequest,
  type InviteUserResponse,
  type LoginRequest,
  type LoginResponse,
  type LoginStateResponse,
  type OrganizationUserResponse,
  type UpdateSsoOidcProviderRequest,
  type RemoveUserResponse,
  type SsoOidcProviderResponse,
  type WhoAmICommandResponse,
  type WhoAmIQuery,
  type WhoAmIResponse,
  ssoOidcProviderResponseSchema,
  userAccessDetailResponseSchema,
  type UserAccessDetailResponse,
  whoamiCommandResponseSchema,
  whoamiResponseSchema,
} from '../src';
import {
  buildAccessGroupResponse,
  buildAccessRoleResponse,
  buildInviteUserResponse,
  buildOrganizationUserResponse,
  buildSsoOidcProviderResponse,
  buildUserAccessDetailResponse,
  buildWhoAmIResponse,
} from './schema-test.fixtures';
import { expectPresent, expectSchemaRejects } from './schema-test.helpers';

interface ContractOrganizationSummaryPayload {
  id: string;
  name: string;
  slug: string;
}

interface ContractPrincipalSummaryPayload {
  email: string;
  id: string;
  type: 'user';
}

interface LoginResponseWithoutDeliveryPayload {
  organizations: ContractOrganizationSummaryPayload[];
  principal: ContractPrincipalSummaryPayload;
}

interface LoginResponseWithBothDeliveryPayload extends LoginResponseWithoutDeliveryPayload {
  redirectTo: string;
  sessionToken: string;
}

interface LoginRedirectStateResponseWithoutTargetPayload {
  flowTarget: null;
  view: 'redirect';
}

describe('contract schemas identity and OIDC', (): void => {
  it('accepts an activation response without visible organizations', (): void => {
    const result: ActivateResponse = activateResponseSchema.parse({
      organizations: [],
      principal: {
        email: 'viewer@example.com',
        id: 'prn_456',
        type: 'user',
      },
      sessionToken: 'session_456',
    });

    expect(result.organizations).toHaveLength(0);
  });

  it('rejects a login response without visible organizations', (): void => {
    const result: SafeParseReturnType<LoginResponse, LoginResponse> = loginResponseSchema.safeParse({
      organizations: [],
      principal: {
        email: 'viewer@example.com',
        id: 'prn_456',
        type: 'user',
      },
      sessionToken: 'session_456',
    });

    expect(result.success).toBe(false);
  });

  it('accepts browser cookie login responses with a redirect target', (): void => {
    const result: LoginResponse = loginResponseSchema.parse({
      organizations: [
        {
          id: 'org_123',
          name: 'Acme Dev',
          slug: 'acme-dev',
        },
      ],
      principal: {
        email: 'viewer@example.com',
        id: 'prn_456',
        type: 'user',
      },
      redirectTo: '/projects',
    });

    expect(result.redirectTo).toBe('/projects');
  });

  it('rejects successful login responses without a delivery field', (): void => {
    const payload: LoginResponseWithoutDeliveryPayload = {
      organizations: [
        {
          id: 'org_123',
          name: 'Acme Dev',
          slug: 'acme-dev',
        },
      ],
      principal: {
        email: 'viewer@example.com',
        id: 'prn_456',
        type: 'user',
      },
    };
    const result: SafeParseReturnType<LoginResponse, LoginResponse> = loginResponseSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it('rejects successful login responses with both delivery fields', (): void => {
    const payload: LoginResponseWithBothDeliveryPayload = {
      organizations: [
        {
          id: 'org_123',
          name: 'Acme Dev',
          slug: 'acme-dev',
        },
      ],
      principal: {
        email: 'viewer@example.com',
        id: 'prn_456',
        type: 'user',
      },
      redirectTo: '/projects',
      sessionToken: 'session_456',
    };
    const result: SafeParseReturnType<LoginResponse, LoginResponse> = loginResponseSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it('requires redirect targets for redirect login states', (): void => {
    const payload: LoginRedirectStateResponseWithoutTargetPayload = {
      flowTarget: null,
      view: 'redirect',
    };
    const result: SafeParseReturnType<LoginStateResponse, LoginStateResponse> =
      loginStateResponseSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it('rejects a short password', (): void => {
    const result: SafeParseReturnType<LoginRequest, LoginRequest> = loginRequestSchema.safeParse({
      email: 'admin@example.com',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('accepts whoami without a selected organization', (): void => {
    const result: WhoAmIResponse = whoamiResponseSchema.parse(
      buildWhoAmIResponse({
        currentOrganization: null,
        currentOrganizationPermissions: [],
      }),
    );

    expect(result.currentOrganization).toBeNull();
    expect(result.currentOrganizationPermissions).toEqual([]);
  });

  it('accepts whoami with a selected organization permission set', (): void => {
    const result: WhoAmIResponse = whoamiResponseSchema.parse(buildWhoAmIResponse());

    expect(expectPresent(result.currentOrganization, 'current organization').slug).toBe('acme-dev');
    expect(result.currentOrganizationPermissions).toEqual(['project.read']);
  });

  it('accepts scoped whoami queries only when project and environment are provided together', (): void => {
    const result: WhoAmIQuery = whoamiQuerySchema.parse({
      environmentName: 'production',
      projectName: 'billing',
    });

    expect(result).toEqual({
      environmentName: 'production',
      projectName: 'billing',
    });
    expect((): WhoAmIQuery => whoamiQuerySchema.parse({ projectName: 'billing' })).toThrow(
      'projectName and environmentName must be provided together.',
    );
  });

  it('accepts whoami CLI payloads with the authenticated API URL', (): void => {
    const result: WhoAmICommandResponse = whoamiCommandResponseSchema.parse({
      apiUrl: 'https://console.example.com',
      remoteName: 'default',
      principal: {
        id: 'prn_123',
        type: 'user',
        email: 'admin@example.com',
      },
      currentOrganization: null,
    });

    expect(result.apiUrl).toBe('https://console.example.com');
  });

  it('accepts user invitation request payloads', (): void => {
    const result: InviteUserRequest = inviteUserRequestSchema.parse({
      email: 'viewer@example.com',
    });

    expect(result.email).toBe('viewer@example.com');
  });

  it('accepts user invitation response payloads with a browser activation link', (): void => {
    const result: InviteUserResponse = inviteUserResponseSchema.parse(buildInviteUserResponse());

    expect(result.user.status).toBe('invited');
    expect(expectPresent(result.invitation, 'invitation').bootstrapToken).toBe('bootstrap_123');
  });

  it('accepts RBAC role response payloads', (): void => {
    const result: AccessRoleResponse = accessRoleResponseSchema.parse(buildAccessRoleResponse());

    expect(result.role.permissionKeys).toEqual(['deployment.create', 'variable.write']);
  });

  it('accepts RBAC group response payloads', (): void => {
    const result: AccessGroupResponse = accessGroupResponseSchema.parse(buildAccessGroupResponse());

    expect(result.group.name).toBe('Operators');
  });

  it('accepts RBAC group member list payloads', (): void => {
    const result: AccessGroupMemberListResponse = accessGroupMemberListResponseSchema.parse({
      members: [
        {
          email: 'viewer@example.com',
          id: 'prn_123',
          status: 'invited',
        },
      ],
    });

    expect(expectPresent(result.members[0], 'member').status).toBe('invited');
  });

  it('accepts RBAC assignment response payloads', (): void => {
    const result: AccessAssignmentResponse = accessAssignmentResponseSchema.parse({
      assignment: {
        createdAt: '2026-05-05T10:00:00.000Z',
        id: 'asg_123',
        roleId: 'rol_123',
        roleKind: 'custom',
        roleName: 'Project Operator',
        scope: {
          projectName: 'billing',
          scopeType: 'project',
        },
        subject: {
          principalEmail: 'viewer@example.com',
          subjectType: 'principal',
        },
      },
    });

    expect(result.assignment.scope.scopeType).toBe('project');
  });

  it('accepts assignment scope options payloads', (): void => {
    const result: AccessAssignmentScopeOptionsResponse = accessAssignmentScopeOptionsResponseSchema.parse({
      projects: [
        {
          environmentNames: ['production', 'staging'],
          projectName: 'billing',
        },
      ],
    });

    expect(expectPresent(result.projects[0], 'project').environmentNames).toEqual(['production', 'staging']);
  });

  it('rejects RBAC assignment payloads with non-canonical project names', (): void => {
    expectSchemaRejects(createAccessAssignmentRequestSchema, {
      roleId: 'rol_123',
      scope: {
        projectName: 'Billing_App',
        scopeType: 'project',
      },
      subject: {
        principalEmail: 'viewer@example.com',
        subjectType: 'principal',
      },
    });
    expectSchemaRejects(accessAssignmentResponseSchema, {
      assignment: {
        createdAt: '2026-05-05T10:00:00.000Z',
        id: 'asg_123',
        roleId: 'rol_123',
        roleKind: 'custom',
        roleName: 'Project Operator',
        scope: {
          environmentName: 'production',
          projectName: 'Billing_App',
          scopeType: 'environment',
        },
        subject: {
          principalEmail: 'viewer@example.com',
          subjectType: 'principal',
        },
      },
    });
    expectSchemaRejects(accessAssignmentScopeOptionsResponseSchema, {
      projects: [
        {
          environmentNames: ['production'],
          projectName: 'Billing_App',
        },
      ],
    });
  });

  it('accepts user access detail payloads', (): void => {
    const result: UserAccessDetailResponse = userAccessDetailResponseSchema.parse(buildUserAccessDetailResponse());

    expect(result.access.effectivePermissions).toEqual(['project.read', 'deployment.read']);
  });

  it('accepts organization user response payloads', (): void => {
    const result: OrganizationUserResponse = organizationUserResponseSchema.parse(
      buildOrganizationUserResponse({
        user: {
          email: 'deployer@example.com',
          id: 'prn_789',
          roleNames: ['Deployer'],
          status: 'active',
        },
      }),
    );

    expect(result.user.roleNames).toEqual(['Deployer']);
  });

  it('accepts successful remove user responses', (): void => {
    const result: RemoveUserResponse = removeUserResponseSchema.parse({
      success: true,
    });

    expect(result.success).toBe(true);
  });

  it('accepts generic OIDC SSO provider configuration requests', (): void => {
    const result: ConfigureSsoOidcProviderRequest = configureSsoOidcProviderRequestSchema.parse({
      clientId: 'client_123',
      clientSecret: 'secret_123',
      displayName: 'Okta',
      identityVerification: {
        emailClaims: [{ claim: 'email', source: 'id_token' }],
        emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'id_token' }],
        verifiedEmailClaims: [],
      },
      issuerUrl: 'https://idp.example.com',
      key: 'okta',
      preset: 'generic',
      provisioning: {
        allowedEmailDomains: ['example.com'],
        autoJoinEnabled: true,
        defaultRole: 'viewer',
      },
      scope: 'openid email profile',
    });

    expect(result.issuerUrl).toBe('https://idp.example.com');
    expect(result.provisioning).toEqual({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });
  });

  it('accepts OIDC SSO provider configuration requests with default identity verification', (): void => {
    const result: ConfigureSsoOidcProviderRequest = configureSsoOidcProviderRequestSchema.parse({
      clientId: 'client_123',
      clientSecret: 'secret_123',
      key: 'google',
      preset: 'google',
    });

    expect(result.identityVerification).toBeUndefined();
  });

  it('accepts partial OIDC SSO provider updates without requiring the current client secret', (): void => {
    const result: UpdateSsoOidcProviderRequest = updateSsoOidcProviderRequestSchema.parse({
      key: 'okta-workspace',
    });

    expect(result.clientSecret).toBeUndefined();
    expect(result.key).toBe('okta-workspace');
  });

  it('rejects empty OIDC SSO provider updates', (): void => {
    const result: SafeParseReturnType<UpdateSsoOidcProviderRequest, UpdateSsoOidcProviderRequest> =
      updateSsoOidcProviderRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects OIDC SSO provider verification without an email source', (): void => {
    const result: SafeParseReturnType<ConfigureSsoOidcProviderRequest, ConfigureSsoOidcProviderRequest> =
      configureSsoOidcProviderRequestSchema.safeParse({
        clientId: 'client_123',
        clientSecret: 'secret_123',
        displayName: 'Okta',
        identityVerification: {
          emailClaims: [],
          emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'id_token' }],
          verifiedEmailClaims: [],
        },
        issuerUrl: 'https://idp.example.com',
        key: 'okta',
        preset: 'generic',
      });

    expect(result.success).toBe(false);
  });

  it('rejects OIDC SSO provider verification with unknown claim sources', (): void => {
    const result: SafeParseReturnType<ConfigureSsoOidcProviderRequest, ConfigureSsoOidcProviderRequest> =
      configureSsoOidcProviderRequestSchema.safeParse({
        clientId: 'client_123',
        clientSecret: 'secret_123',
        displayName: 'Okta',
        identityVerification: {
          emailClaims: [{ claim: 'email', source: 'access_token' }],
          emailVerifiedClaims: [],
          verifiedEmailClaims: [],
        },
        issuerUrl: 'https://idp.example.com',
        key: 'okta',
        preset: 'generic',
      });

    expect(result.success).toBe(false);
  });

  it('rejects generic OIDC SSO provider configuration without an issuer URL', (): void => {
    const result: SafeParseReturnType<ConfigureSsoOidcProviderRequest, ConfigureSsoOidcProviderRequest> =
      configureSsoOidcProviderRequestSchema.safeParse({
        clientId: 'client_123',
        clientSecret: 'secret_123',
        key: 'generic',
        preset: 'generic',
      });

    expect(result.success).toBe(false);
  });

  it('rejects OIDC SSO provider configuration without openid scope', (): void => {
    const result: SafeParseReturnType<ConfigureSsoOidcProviderRequest, ConfigureSsoOidcProviderRequest> =
      configureSsoOidcProviderRequestSchema.safeParse({
        clientId: 'client_123',
        clientSecret: 'secret_123',
        issuerUrl: 'https://idp.example.com',
        key: 'generic',
        preset: 'generic',
        scope: 'email profile',
      });

    expect(result.success).toBe(false);
  });

  it('rejects enabled OIDC auto-join without allowed email domains', (): void => {
    const result: SafeParseReturnType<ConfigureSsoOidcProviderRequest, ConfigureSsoOidcProviderRequest> =
      configureSsoOidcProviderRequestSchema.safeParse({
        clientId: 'client_123',
        clientSecret: 'secret_123',
        issuerUrl: 'https://idp.example.com',
        key: 'generic',
        preset: 'generic',
        provisioning: {
          allowedEmailDomains: [],
          autoJoinEnabled: true,
          defaultRole: 'viewer',
        },
      });

    expect(result.success).toBe(false);
  });

  it('accepts OIDC SSO provider responses without exposing the client secret', (): void => {
    const result: SsoOidcProviderResponse = ssoOidcProviderResponseSchema.parse(buildSsoOidcProviderResponse());

    expect(expectPresent(result.provider, 'provider').preset).toBe('google');
  });

  it('accepts successful OIDC SSO provider deletion responses', (): void => {
    const result: DeleteSsoOidcProviderResponse = deleteSsoOidcProviderResponseSchema.parse({
      success: true,
    });

    expect(result.success).toBe(true);
  });
});
