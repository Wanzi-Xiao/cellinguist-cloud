FROM public.ecr.aws/lambda/python:3.12
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt
COPY app.py digest.py object_json.py benchmark.py ${LAMBDA_TASK_ROOT}/
CMD ["app.handler"]
