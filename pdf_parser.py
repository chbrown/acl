import popplerqt4

# Poppler Documentation:
# http://people.freedesktop.org/~aacid/docs/qt4/namespacePoppler.html

def read_page_lines(page):
    '''
    Yields lists of TextBox objects (one list per line)
    '''
    line = []
    for text_box in page.textList():
        line.append(text_box)
        if not text_box.hasSpaceAfter():
            yield line
            line = []

def read_page_paragraphs(page):
    '''
    Yields lists of lines
        where lines are lists of strings
    '''
    previous_line_height = 0
    previous_line_leftmost_x = 100000
    previous_line_highest_y = 100000

    paragraph = []

    for text_boxes in read_page_lines(page):
        line = [unicode(text_box.text()) for text_box in text_boxes]
        #leftmost_x = text_boxes[0].boundingBox().x()
        leftmost_x = min(text_box.boundingBox().x() for text_box in text_boxes)
        height = max(text_box.boundingBox().height() for text_box in text_boxes)
        highest_y = min(text_box.boundingBox().y() for text_box in text_boxes)

        skip = highest_y - (previous_line_highest_y + previous_line_height)
        if abs(skip) > 5:
            yield paragraph
            paragraph = []

        paragraph.append(line)

        previous_line_height = height
        previous_line_leftmost_x = leftmost_x
        previous_line_highest_y = highest_y

def read_document_paragraphs(document):
    for i in range(document.numPages()):
        for paragraph in read_page_paragraphs(document.page(i)):
            # skip over empty paragraphs
            if len(paragraph):
                yield paragraph

def read_document_references(document):
    '''
    Read paragraphs and toss them aside up until we reach a line containing
    the string "References" and not much else. After that yield all paragraphs as usual
    '''
    references_header_reached = False
    for paragraph in read_document_paragraphs(document):
        if references_header_reached is False:
            for line in paragraph:
                if 'References' in line and len(line) < 20:
                    references_header_reached = True

        if references_header_reached is True:
            yield paragraph

def unwrap_paragraph(paragraph):
    '''
    Take a list of list of strings, yield strings, de-hyphenated
    '''
    carry = None
    for line in paragraph:
        for token in line[:-1]:
            if carry:
                yield carry + token
                carry = None
            else:
                yield token

        # only consider hyphenation at the end of the line
        token = line[-1]
        if token.endswith('-'):
            carry = token[:-1]
        else:
            yield token

#paragraph_string = u' '.join(token for line in paragraph for token in line)

def read_pdf_references(filepath):
    document = popplerqt4.Poppler.Document.load(filepath)
    for paragraph in read_document_references(document):
        tokens = unwrap_paragraph(paragraph)
        yield u' '.join(tokens)

if __name__ == '__main__':
    import sys
    import argparse
    parser = argparse.ArgumentParser(
        description='Find references in a PDF',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('infile', nargs='?', type=argparse.FileType('r'), default=sys.stdin,
        help='Input PDF path (defaults to STDIN)')
    parser.add_argument('outfile', nargs='?', type=argparse.FileType('w'), default=sys.stdout,
        help='Output txt path (defaults to STDOUT)')
    opts = parser.parse_args()

    document = popplerqt4.Poppler.Document.loadFromData(opts.infile.read())
    for paragraph in read_document_references(document):
        tokens = unwrap_paragraph(paragraph)
        print >> opts.outfile, u' '.join(tokens).encode('utf-8')
