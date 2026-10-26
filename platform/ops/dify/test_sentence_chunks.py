import unittest
from sentence_chunks import main, sentences, bounded


class SentenceTests(unittest.TestCase):
    def test_chinese_quotes(self):
        self.assertEqual(sentences('他说：“你好！”她回答：“好的。”随后离开。'), ['他说：“你好！”', '她回答：“好的。”', '随后离开。'])

    def test_decimal_url_abbreviation(self):
        self.assertEqual(sentences('Dr. Li paid 3.14 dollars. Visit https://example.com/a. Done!'), ['Dr. Li paid 3.14 dollars.', 'Visit https://example.com/a.', 'Done!'])

    def test_line_wrap_does_not_break_sentence(self):
        self.assertEqual(sentences('这是一个\n被换行的句子。下句？'), ['这是一个\n被换行的句子。', '下句？'])

    def test_long_sentence_preserves_content(self):
        sentence = '甲' * 400 + '，' + '乙' * 600 + '。'
        parts = bounded(sentence)
        self.assertTrue(all(len(p) <= 512 for p in parts))
        self.assertEqual(''.join(parts), sentence)

    def test_parent_and_duplicates_preserved(self):
        text = '原文。原文。'
        result = main({'parent_child_chunks': [{'parent_content': text, 'child_contents': ['wrong']}]})
        self.assertEqual(result['result']['parent_child_chunks'][0], {'parent_content': text, 'child_contents': ['原文。', '原文。']})
        self.assertEqual(result['sentence_count'], 2)

    def test_empty_fails(self):
        with self.assertRaises(ValueError):
            main({'parent_child_chunks': []})


if __name__ == '__main__':
    unittest.main()
