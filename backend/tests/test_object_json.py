import gzip
import io
import json
import unittest
from object_json import read_json_object, MAX_JSON_BYTES, MAX_WIRE_BYTES


class ObjectJsonTests(unittest.TestCase):
    def test_plain_and_gzip_produce_identical_objects_and_close_stream(self):
        payload = {"synthetic": True, "text": "合成" * 300}
        plain = json.dumps(payload).encode()
        for data, encoding in ((plain, None), (gzip.compress(plain), "gzip")):
            with self.subTest(encoding=encoding):
                stream = io.BytesIO(data)
                self.assertEqual(read_json_object(stream, encoding), payload)
                self.assertTrue(stream.closed)
    def test_truncated_or_corrupt_gzip_is_rejected(self):
        encoded = gzip.compress(b'{"synthetic":true}')
        for data in (encoded[:-5], b'not gzip', encoded[:-1]+bytes([encoded[-1]^255])):
            with self.assertRaisesRegex(RuntimeError, "compressed"):
                read_json_object(io.BytesIO(data), "gzip")
    def test_inflation_limit_rejects_small_compressed_large_payload(self):
        data = gzip.compress(b'{"padding":"'+b'x'*(MAX_JSON_BYTES+1)+b'"}')
        self.assertLess(len(data), 1024)
        with self.assertRaisesRegex(RuntimeError, "decoded size"):
            read_json_object(io.BytesIO(data), "gzip")
    def test_wire_limit_and_body_closure(self):
        stream = io.BytesIO(b'x'*(MAX_WIRE_BYTES+1))
        with self.assertRaisesRegex(RuntimeError, "wire size"):
            read_json_object(stream)
        self.assertTrue(stream.closed)
    def test_bad_json_schema_and_unknown_encoding(self):
        for data, encoding in ((b'[]',None),(b'{bad',None),(b'{}','br')):
            with self.assertRaises(RuntimeError):
                read_json_object(io.BytesIO(data),encoding)
    def test_exact_decoded_limit_is_accepted(self):
        data=b'{"padding":"'+b'x'*(MAX_JSON_BYTES-14)+b'"}'
        self.assertEqual(len(data),MAX_JSON_BYTES)
        self.assertIsInstance(read_json_object(io.BytesIO(gzip.compress(data)), 'gzip'),dict)


if __name__ == "__main__":
    unittest.main()
