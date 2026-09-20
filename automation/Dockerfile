# Build context: ./automation
# Ships the Docker CLI + compose plugin: this service provisions Buildfarm stacks by talking to the
# host's Docker daemon through a mounted socket (see docker-compose.yml). They become sibling
# containers on the host, which is what makes their published ports reachable from the host's Bazel.
FROM docker:cli AS dockercli

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN ./generate_protos.sh
ENV RUNTIME_DIR=/data/runtime
EXPOSE 9000 9095
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
