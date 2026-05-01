TEX ?= slides.tex
PDF := $(TEX:.tex=.pdf)
AUTOCOMPILE := ./scripts/autocompile.sh

.PHONY: slides watch clean

slides:
	$(AUTOCOMPILE) "$(TEX)" once

watch:
	$(AUTOCOMPILE) "$(TEX)" watch

clean:
	latexmk -C "$(TEX)"
	rm -f "$(PDF)"
