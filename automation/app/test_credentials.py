"""First Python test suite in automation/app/ (see the plan's Verification section). Covers the
one place boto3 talks to STS directly with a customer-submitted secret."""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from . import credentials
from .credentials import CredentialValidationError

ROLE_ARN = "arn:aws:iam::123456789012:role/CroftBuildfarmProvisioner"


@mock_aws
def test_assume_role_returns_usable_session_credentials():
    result = credentials.assume_role(
        ROLE_ARN, "ext-123", "AKIAFAKEFAKEFAKEFAKE", "fake-secret", "us-east-1", "croft-provision-ws1"
    )
    assert result["accessKeyId"]
    assert result["secretAccessKey"]
    assert result["sessionToken"]


@mock_aws
def test_validate_assume_role_returns_assumed_role_arn():
    arn = credentials.validate_assume_role(ROLE_ARN, "ext-123", "AKIAFAKEFAKEFAKEFAKE", "fake-secret", "us-east-1")
    assert arn.startswith("arn:aws:sts::123456789012:assumed-role/")


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": f"{code} from AWS"}}, "AssumeRole")


def test_assume_role_calls_sts_with_the_exact_role_external_id_and_session_name():
    fake_client = MagicMock()
    fake_client.assume_role.return_value = {
        "Credentials": {"AccessKeyId": "AKID", "SecretAccessKey": "SECRET", "SessionToken": "TOKEN"}
    }
    with patch("boto3.client", return_value=fake_client) as make_client:
        result = credentials.assume_role(ROLE_ARN, "ext-123", "AKIA", "secret", "us-east-1", "my-session")

    make_client.assert_called_once_with(
        "sts", aws_access_key_id="AKIA", aws_secret_access_key="secret", region_name="us-east-1"
    )
    fake_client.assume_role.assert_called_once_with(
        RoleArn=ROLE_ARN,
        RoleSessionName="my-session",
        ExternalId="ext-123",
        DurationSeconds=credentials.PROVISION_SESSION_DURATION_SECONDS,
    )
    assert result == {"accessKeyId": "AKID", "secretAccessKey": "SECRET", "sessionToken": "TOKEN"}


def test_assume_role_wraps_a_client_error_as_credential_validation_error():
    fake_client = MagicMock()
    fake_client.assume_role.side_effect = _client_error("AccessDenied")
    with patch("boto3.client", return_value=fake_client):
        with pytest.raises(CredentialValidationError, match="AccessDenied"):
            credentials.assume_role(ROLE_ARN, "ext-123", "AKIA", "secret", "us-east-1", "my-session")


def test_validate_assume_role_wraps_a_client_error_as_credential_validation_error():
    fake_client = MagicMock()
    fake_client.assume_role.side_effect = _client_error("InvalidClientTokenId")
    with patch("boto3.client", return_value=fake_client):
        with pytest.raises(CredentialValidationError, match="InvalidClientTokenId"):
            credentials.validate_assume_role(ROLE_ARN, "ext-123", "AKIA", "secret", "us-east-1")
