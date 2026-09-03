/**
 * The reference implementation, lifted verbatim from pdf-bullets.
 *
 * Source: https://github.com/AF-VCD/pdf-bullets, src/components/Bullets/utils.js
 * at 8f104b0. This is the tool Bullet Bench is measured against: it is the one
 * people already use, so where the two disagree about how a bullet should be
 * spaced, this file is the one that is right by definition.
 *
 * Copyright (c) 2020 Christopher Kodama. Used under the MIT License:
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the "Software"),
 *   to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *   and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *   DEALINGS IN THE SOFTWARE.
 *
 * Kept byte-for-byte apart from the import line and the exported STATUS, so it
 * can be re-pulled when upstream changes. Do not tidy it and do not let a lint
 * rule near it.
 *
 * The one thing NOT taken from upstream is the width function. Upstream
 * measures with canvas measureText at "12pt Times New Roman", which is exactly
 * what constraint 1 and the metrics note in CLAUDE.md forbid -- it silently
 * substitutes a different face when Times is not installed. The harness at the
 * bottom takes a width function instead, so a differential test can feed BOTH
 * engines the same measurements and compare the algorithms alone.
 */

/* eslint-disable */

export const STATUS = {
  OPTIMIZED: 0,
  FAILED_OPT: 1,
  NOT_OPT: -1,
  MAX_UNDERFLOW: -4,
};


/* 
str: string
return: number
*/
const hashCode = (str) => {
  let hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

    // Regex- split after one of the following: \u2004 \u2009 \u2006 \s ? / | - % !
    // but ONLY if immediately followed by: [a-zA-z] [0-9] + \
const AdobeLineSplitFn = (text)=>{
  const regex = /([\u2004\u2009\u2006\s?/|\-%!])(?=[a-zA-Z0-9+\\])/
  return text.split(regex).filter(Boolean);
}

/*
seed: string
max: number
return: number
*/
const getRandomInt = (seed, max) => {
  return Math.floor(
    Math.abs((Math.floor(9 * hashCode(seed) + 5) % 100000) / 100000) *
      Math.floor(max)
  );
};

const tokenize = (sentence) => {
  return sentence.split(/[\s]+/);
};

/*
sentence: string
evalFcn: string to 
        results: {
            textLines: string,
            fullWidth: number,
            lines: number,
            overflow: number,
        };
return: {
    status: STATUS
    rendering: results
}
*/
const optimize = (sentence, evalFcn) => {
  const smallerSpace = "\u2006";
  const largerSpace = "\u2004";

  //initialization of optimized words array
  let optWords = tokenize(sentence.trimEnd());

  const initResults = evalFcn(sentence);

  // Sentence is fine, don't need to optimize
  if (initResults.overflow === 0) {
    return {
      status: STATUS.OPTIMIZED,
      rendering: initResults,
    };
  }

  //initial instantiation of previousResults
  let prevResults = initResults;
  let finalResults = initResults;
  const newSpace = initResults.overflow >= 0 ? smallerSpace : largerSpace;

  let finalOptimStatus = STATUS.NOT_OPT;

  // like in the while loop, want to not replace the first space after the dash.
  const worstCaseResults = evalFcn(
    optWords[0] + " " + optWords.slice(1).join(newSpace)
  );

  if (
    (newSpace === smallerSpace && worstCaseResults.overflow > 0) ||
    (newSpace === largerSpace &&
      worstCaseResults.overflow < STATUS.MAX_UNDERFLOW)
  ) {
    // this means that there is no point in trying to optimize.

    return {
      status: STATUS.FAILED_OPT,
      rendering: worstCaseResults,
    };
  }

  while (true) {
    //don't select the first space after the dash- that would be noticeable and look wierd.
    // also don't select the last word, don't want to add a space after that.
    let indexToReplace =
      getRandomInt(optWords.join(""), optWords.length - 1 - 1) + 1;

    //merges two elements together, joined by the space
    optWords.splice(
      indexToReplace,
      2,
      optWords.slice(indexToReplace, indexToReplace + 2).join(newSpace)
    );

    //make all other spaces the normal space size
    let newSentence = optWords.join(" ");

    //console.log(newSentence.split(' '))
    let newResults = evalFcn(newSentence);

    if (newSpace === largerSpace && newResults.overflow > 0) {
      //console.log("Note: Can't add more spaces without overflow, reverting to previous" );
      finalResults = prevResults;
      finalOptimStatus = STATUS.OPTIMIZED;
      break;
    } else if (newSpace === smallerSpace && newResults.overflow <= 0) {
      //console.log("Removed enough spaces. Terminating." );
      finalResults = newResults;
      finalOptimStatus = STATUS.OPTIMIZED;
      break;
    } else if (optWords.length <= 2) {
      // no more optimization could be done.
      finalResults = newResults;
      if (
        newSpace === largerSpace &&
        finalResults.overflow > STATUS.MAX_UNDERFLOW
      ) {
        finalOptimStatus = STATUS.OPTIMIZED;
      } else {
        finalOptimStatus = STATUS.FAILED_OPT;
      }
      break;
    }

    prevResults = newResults;
  }

  /*   console.log({
    sentence,
    optWords,
    initResults,
    finalResults,
    worstCaseResults,
    finalOptimStatus,
  }); */

  return {
    status: finalOptimStatus,
    rendering: finalResults,
  };
};

/*
text: string
getWidth: function: string to number
width: string
return: results: {
            textLines: string,
            fullWidth: number,
            lines: number,
            overflow: number,
        };
*/
// all widths in this function are in pixels
const renderBulletText = (text, getWidth, width) => {
  // this function expects a single line of text with no line breaks.
  if (text.match("\n")) {
    console.error("renderBulletText expects a single line of text");
  }

  const fullWidth = getWidth(text.trimEnd());
  if (text === "") {
    return {
      textLines: [],
      fullWidth: 0,
      lines: 0,
      overflow: 0 - width,
    };
  }
  if (fullWidth < width) {
    return {
      textLines: [text],
      fullWidth: fullWidth,
      lines: 1,
      overflow: fullWidth - width,
    };
  } else {
    // Scenario where the width of the text is wider than desired.
    //  In this case, work needs to be done to figure out where the line breaks should be.

    // Regex- split after one of the following: \u2004 \u2009 \u2006 \s ? / | - % !
    // but ONLY if immediately followed by: [a-zA-z] [0-9] + \
    const textSplit = AdobeLineSplitFn(text); 

    // check to make sure the first token is smaller than the desired width.
    //   This is usually true, unless the desired width is abnormally small, or the
    //   input text is one really long word
    if (getWidth(textSplit[0].trimEnd()) < width) {
      let answerIdx = 0;
      for (let i = 1; i <= textSplit.length; i++) {
        const evalText = textSplit.slice(0, i).join("").trimEnd();
        const evalWidth = getWidth(evalText);
        if (evalWidth > width) {
          answerIdx = i - 1;
          break;
        }
      }
      const recursedText = textSplit
        .slice(answerIdx, textSplit.length)
        .join("");

      if (recursedText === text) {
        console.warn("Can't fit \"" + text + '" on a single line\n', {
          text,
          width,
          fullWidth,
        });
        return {
          textLines: [text],
          fullWidth,
          lines: 1,
          overflow: fullWidth - width,
        };
      } else {
        const recursedResult = renderBulletText(recursedText, getWidth, width);

        return {
          textLines: [
            textSplit.slice(0, answerIdx).join(""),
            ...recursedResult.textLines,
          ],
          fullWidth: fullWidth,
          lines: 1 + recursedResult.lines,
          overflow: fullWidth - width,
        };
      }
    } else {
      // if the first token is wider than the desired width, a line break will need to be inserted somewhere in the token.
      // Using binary search (I think) to find the correct spot for the line break.
      const avgCharWidth = fullWidth / text.length;
      const guessIndex = parseInt(width / avgCharWidth);
      const firstGuessWidth = getWidth(text.substring(0, guessIndex));
      let answerIdx = guessIndex;
      if (firstGuessWidth > width) {
        for (let i = guessIndex - 1; i > 0; i--) {
          const nextGuessWidth = getWidth(text.substring(0, i));
          if (nextGuessWidth < width) {
            answerIdx = i;
            break;
          }
        }
      } else if (firstGuessWidth < width) {
        for (let i = guessIndex; i <= text.length; i++) {
          const nextGuessWidth = getWidth(text.substring(0, i));
          if (nextGuessWidth > width) {
            answerIdx = i - 1;
            break;
          }
        }
      }
      const recursedText = text.substring(answerIdx, text.length);
      if (recursedText === text) {
        console.warn("Can't fit \"" + text + '" on a single line\n', {
          text,
          width,
          fullWidth,
        });
        return {
          textLines: [text],
          fullWidth,
          lines: 1,
          overflow: fullWidth - width,
        };
      } else {
        const recursedResult = renderBulletText(recursedText, getWidth, width);

        return {
          textLines: [
            text.substring(0, answerIdx),
            ...recursedResult.textLines,
          ],
          fullWidth: fullWidth,
          lines: 1 + recursedResult.lines,
          overflow: fullWidth - width,
        };
      }
    }
  }
};

/* ------------------------------------------------------------------ *
 * Harness. Not from pdf-bullets.
 * ------------------------------------------------------------------ */

export { hashCode, getRandomInt, tokenize, AdobeLineSplitFn, optimize, renderBulletText };

/**
 * Runs upstream's optimizer over one line.
 *
 * `getWidth` and `width` are in whatever unit the caller likes -- upstream uses
 * pixels at 96dpi, the differential test uses millimetres -- as long as
 * `maxUnderflow` is in the same unit.
 */
export function runReference(line, getWidth, width, maxUnderflow) {
  const previous = STATUS.MAX_UNDERFLOW;
  STATUS.MAX_UNDERFLOW = maxUnderflow;
  try {
    const evalFcn = (txt) => renderBulletText(txt, getWidth, width);
    const result = optimize(line, evalFcn);
    return {
      status: result.status,
      text: result.rendering.textLines.join(''),
      textLines: result.rendering.textLines,
      lines: result.rendering.lines,
      overflow: result.rendering.overflow,
      fullWidth: result.rendering.fullWidth,
    };
  } finally {
    STATUS.MAX_UNDERFLOW = previous;
  }
}
