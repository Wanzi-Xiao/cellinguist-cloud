import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from digest import handler


class DigestTests(unittest.TestCase):
    def run_digest(self, event):
        calls=[]
        class Metrics:
            def get_metric_statistics(self, **kwargs):
                self.last=kwargs
                return {"Datapoints":[{"Sum":2},{"Sum":3}]} if kwargs['MetricName']=='Invocations' else {"Datapoints":[]}
        class Sns:
            def publish(self, **kwargs):
                calls.append(kwargs)
                return {"MessageId":"test-message-id"}
        clients={'cloudwatch':Metrics(),'sns':Sns()}
        with patch.dict(os.environ,{'API_FUNCTION':'test-api','TOPIC_ARN':'test-topic'}):
            with self.assertLogs('digest',level='INFO') as logs:
                result=handler(event,SimpleNamespace(aws_request_id='test-request'),clients.__getitem__)
        return result,calls,logs.output
    def test_one_time_check_is_labeled_and_publish_id_is_logged(self):
        result,calls,logs=self.run_digest({'source':'cellinguist-course-scheduler-check'})
        self.assertEqual(result['source'],'scheduled-check')
        self.assertIn('TEST',calls[0]['Subject'])
        self.assertIn('not an actual failure',calls[0]['Message'])
        self.assertIn('Invocations: 5',calls[0]['Message'])
        self.assertIn('Errors: 0',calls[0]['Message'])
        self.assertIn('test-message-id',logs[0])
    def test_regular_digest_does_not_echo_arbitrary_event_fields(self):
        result,calls,logs=self.run_digest({'source':'untrusted text','secret':'not for logs'})
        self.assertEqual(result['source'],'operational')
        self.assertNotIn('TEST',calls[0]['Subject'])
        self.assertNotIn('untrusted',str(calls)+str(logs))
    def test_publish_failure_is_not_reported_as_success(self):
        class Broken:
            def get_metric_statistics(self, **kwargs):return {'Datapoints':[]}
            def publish(self, **kwargs):raise RuntimeError('delivery failure')
        with patch.dict(os.environ,{'API_FUNCTION':'test-api','TOPIC_ARN':'test-topic'}):
            with self.assertRaisesRegex(RuntimeError,'delivery failure'):
                handler({},None,lambda _:Broken())


if __name__=='__main__':unittest.main()
