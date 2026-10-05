# Build context: ./automation
# Ships the Docker CLI + compose plugin: this service provisions Buildfarm stacks by talking to the
# host's Docker daemon through a mounted socket (see docker-compose.yml). They become sibling
# containers on the host, which is what makes their published ports reachable from the host's Bazel.
FROM docker:cli AS dockercli

# Ships the Terraform CLI, for AWS provisioning (see app/terraform_manager.py). Pinned to a minor
# version, same as the dockercli stage above.
FROM hashicorp/terraform:1.16 AS terraformcli

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=terraformcli /bin/terraform /usr/local/bin/terraform
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN ./generate_protos.sh
ENV RUNTIME_DIR=/data/runtime
# Pre-warms the AWS provider plugin into a cache baked into the image, so a workspace's first
# `terraform init` (app/terraform_manager.py) needs no network access at request time -- only this
# build step does. The module dir's own .terraform/lock file from this warm-up isn't used at
# runtime (each workspace gets its own copy of the .tf files, see terraform_manager.sync_module_files),
# so it's removed again immediately after.
ENV TF_PLUGIN_CACHE_DIR=/opt/terraform-plugin-cache
RUN mkdir -p "$TF_PLUGIN_CACHE_DIR" \
    && cd terraform/buildfarm-aws \
    && terraform init -input=false \
    && rm -rf .terraform .terraform.lock.hcl
EXPOSE 9000 9095
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
