FROM public.ecr.aws/lambda/python:3.12

# PostgreSQL client (psql, pg_restore). postgresql15 is in the AL2023 repos;
# if unavailable in your build, swap to postgresql16.
RUN dnf install -y postgresql15 && dnf clean all

# boto3 is preinstalled in the Lambda Python base image.

# Seed files + handler (paths are relative to the repo-root build context)
WORKDIR ${LAMBDA_TASK_ROOT}
COPY pagila-schema.sql pagila-schema-jsonb.sql pagila-data.sql ./
COPY pagila-data-apt-jsonb.backup pagila-data-yum-jsonb.backup ./
COPY infrastructure/cdk/seeder/handler.py ./

CMD ["handler.on_event"]
