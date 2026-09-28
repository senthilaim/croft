"""Validates that a customer's AWS bootstrap credential can actually assume the role they've named
-- not just that the bootstrap key itself is well-formed. This is the one place boto3 talks to STS
directly with a customer-submitted, not-yet-persisted secret; the backend calls this before it ever
encrypts and stores anything (mirrors RepoConnectionService.connect()'s validate-before-store
pattern for GitHub PATs).
"""

import boto3
from botocore.exceptions import ClientError, NoCredentialsError, ParamValidationError

VALIDATE_SESSION_NAME = "croft-validate"
VALIDATE_SESSION_DURATION_SECONDS = 900  # the minimum STS allows -- this session is used once

# For provision/teardown's real Terraform subprocess calls. An hour is generous for a single
# apply/destroy; called fresh at the start of each operation rather than cached/refreshed, since
# these are infrequent, short-lived operations (see the plan's "Session credentials" reasoning).
PROVISION_SESSION_DURATION_SECONDS = 3600


class CredentialValidationError(Exception):
    """The role could not actually be assumed with the given credentials -- a bad access key, a
    wrong secret, a trust policy that doesn't (yet) allow this principal, or a mismatched
    ExternalId. The message is what boto3/AWS reported, safe to surface to the user."""


def validate_assume_role(
    role_arn: str,
    external_id: str,
    bootstrap_access_key_id: str,
    bootstrap_secret_access_key: str,
    region: str,
) -> str:
    """Returns the assumed role's ARN on success. Raises CredentialValidationError otherwise."""
    client = boto3.client(
        "sts",
        aws_access_key_id=bootstrap_access_key_id,
        aws_secret_access_key=bootstrap_secret_access_key,
        region_name=region,
    )
    try:
        result = client.assume_role(
            RoleArn=role_arn,
            RoleSessionName=VALIDATE_SESSION_NAME,
            ExternalId=external_id,
            DurationSeconds=VALIDATE_SESSION_DURATION_SECONDS,
        )
    except (ClientError, NoCredentialsError, ParamValidationError) as e:
        raise CredentialValidationError(str(e))
    return result["AssumedRoleUser"]["Arn"]


def assume_role(
    role_arn: str,
    external_id: str,
    bootstrap_access_key_id: str,
    bootstrap_secret_access_key: str,
    region: str,
    session_name: str,
) -> dict:
    """Returns real temporary credentials (accessKeyId/secretAccessKey/sessionToken) for a
    Terraform subprocess call -- unlike validate_assume_role, which only confirms the role is
    assumable and discards the credentials it got back. Raises CredentialValidationError on
    failure, same as validate_assume_role (this shouldn't normally happen here, since
    CloudCredentialsService.connect() already validated the role once, but the bootstrap key could
    have been revoked since then)."""
    client = boto3.client(
        "sts",
        aws_access_key_id=bootstrap_access_key_id,
        aws_secret_access_key=bootstrap_secret_access_key,
        region_name=region,
    )
    try:
        result = client.assume_role(
            RoleArn=role_arn,
            RoleSessionName=session_name,
            ExternalId=external_id,
            DurationSeconds=PROVISION_SESSION_DURATION_SECONDS,
        )
    except (ClientError, NoCredentialsError, ParamValidationError) as e:
        raise CredentialValidationError(str(e))
    creds = result["Credentials"]
    return {
        "accessKeyId": creds["AccessKeyId"],
        "secretAccessKey": creds["SecretAccessKey"],
        "sessionToken": creds["SessionToken"],
    }
