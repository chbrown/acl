TYPESCRIPT = $(wildcard *.ts)

all: $(TYPESCRIPT:%.ts=%.js)

%.js: %.ts
	tsc -m commonjs -t ES5 $<

DT_GITHUB := https://raw.githubusercontent.com/borisyankov/DefinitelyTyped/master
DT_RAWGIT := https://rawgit.com/borisyankov/DefinitelyTyped/master

type_declarations/DefinitelyTyped/%:
	mkdir -p $(shell dirname $@)
	curl $(DT_GITHUB)/$* > $@

.PHONY: external

DT_DEPENDENCIES := async/async \
	chalk/chalk \
	form-data/form-data\
	glob/glob \
	htmlparser2/htmlparser2 \
	js-yaml/js-yaml \
	lodash/lodash \
	minimatch/minimatch \
	mkdirp/mkdirp \
	mocha/mocha \
	node/node \
	redis/redis \
	request/request \
	yargs/yargs

DT: $(DT_DEPENDENCIES:%=type_declarations/DefinitelyTyped/%.d.ts)

test: all
	node_modules/.bin/mocha --recursive test/
