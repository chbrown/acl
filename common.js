function countOccurrences(needle, haystack) {
    var occurrences = 0;
    var cursor = 0;
    while (1) {
        cursor = haystack.indexOf(needle, cursor);
        if (cursor == -1) {
            break;
        }
        occurrences++;
        cursor++;
    }
    return occurrences;
}
exports.countOccurrences = countOccurrences;
