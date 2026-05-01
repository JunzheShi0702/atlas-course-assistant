TEX = slides.tex
PDF = ${TEX:.tex=.pdf}

.PHONY: slides watch clean

slides:
	./autocompile.sh "${TEX}" once

watch:
	./autocompile.sh "${TEX}" watch

clean:
	latexmk -C "${TEX}"
	rm -f "${PDF}"
