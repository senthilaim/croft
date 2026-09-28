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
