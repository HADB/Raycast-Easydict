import { DeepLTranslateResult } from "./types";
/*
 * @author: tisfeng
 * @createTime: 2022-06-26 11:13
 * @lastEditor: tisfeng
 * @lastEditTime: 2022-07-19 21:11
 * @fileName: formatData.ts
 *
 * Copyright (c) 2022 by tisfeng, All Rights Reserved.
 */

import {
  AppleTranslateResult,
  BaiduTranslateResult,
  CaiyunTranslateResult,
  QueryWordInfo,
  RequestTypeResult,
  SectionType,
  TencentTranslateResult,
  TranslateDisplayResult,
  TranslateFormatResult,
  TranslateItem,
  TranslationType,
  YoudaoTranslateResult,
} from "./types";
import { checkIfShowMultipleTranslations, myPreferences } from "./utils";

const sortedOrder = getTranslationResultOrder();

/**
 * Format the Youdao original data for later use.
 */
export function formatYoudaoDictionaryResult(youdaoTypeResult: RequestTypeResult): TranslateFormatResult {
  const youdaoResult = youdaoTypeResult.result as YoudaoTranslateResult;
  const translations = youdaoResult.translation.map((translationText) => {
    return {
      type: TranslationType.Youdao,
      text: translationText,
    };
  });

  const [from, to] = youdaoResult.l.split("2"); // from2to
  let usPhonetic = youdaoResult.basic?.["us-phonetic"]; // may be two phonetic "trænzˈleɪʃn; trænsˈleɪʃn"
  usPhonetic = usPhonetic?.split("; ")[1] || usPhonetic;
  const queryWordInfo: QueryWordInfo = {
    word: youdaoResult.query,
    phonetic: usPhonetic || youdaoResult.basic?.phonetic,
    speech: youdaoResult.basic?.["us-speech"],
    fromLanguage: from,
    toLanguage: to,
    isWord: youdaoResult.isWord,
    examTypes: youdaoResult.basic?.exam_type,
    speechUrl: youdaoResult.speakUrl,
  };

  let webTranslation;
  if (youdaoResult.web) {
    webTranslation = youdaoResult.web[0];
  }
  const webPhrases = youdaoResult.web?.slice(1);

  return {
    queryWordInfo: queryWordInfo,
    translationItems: translations,
    explanations: youdaoResult.basic?.explains,
    forms: youdaoResult.basic?.wfs,
    webTranslation: webTranslation,
    webPhrases: webPhrases,
  };
}

/**
 * Update format result with deepl translate result.
 */
export function updateFormatTranslateResultWithDeepLResult(
  formatResult: TranslateFormatResult,
  deepLTypeResult: RequestTypeResult
): TranslateFormatResult {
  const deepLResult = deepLTypeResult.result as DeepLTranslateResult;
  if (deepLResult) {
    formatResult.translationItems.push({
      type: TranslationType.DeepL,
      text: deepLResult.translations[0].text, // deepl will autotically warp the text.
    });
    return sortTranslationItems(formatResult, sortedOrder);
  }
  return formatResult;
}

/**
 * update format result with apple translate result
 */
export function updateFormatResultWithAppleTranslateResult(
  formatResult: TranslateFormatResult,
  appleTranslateResult: RequestTypeResult
): TranslateFormatResult {
  const appleTranslate = appleTranslateResult.result as AppleTranslateResult;
  if (appleTranslate.translatedText) {
    formatResult.translationItems.push({
      type: TranslationType.Apple,
      text: appleTranslate.translatedText,
    });
    return sortTranslationItems(formatResult, sortedOrder);
  }
  return formatResult;
}

/**
 * update format result with baidu translate result
 */
export function updateFormatResultWithBaiduTranslation(
  baiduTypeResult: RequestTypeResult,
  formatResult: TranslateFormatResult
): TranslateFormatResult {
  const baiduResult = baiduTypeResult.result as BaiduTranslateResult;
  if (baiduResult?.trans_result) {
    const baiduTranslation = baiduResult.trans_result
      .map((item) => {
        return item.dst;
      })
      .join("\n");

    formatResult.translationItems.push({
      type: TranslationType.Baidu,
      text: baiduTranslation,
    });
    return sortTranslationItems(formatResult, sortedOrder);
  }
  return formatResult;
}

/**
 * update format result with tencent translate result
 */
export function updateFormatResultWithTencentTranslation(
  tencentTypeResult: RequestTypeResult,
  formatResult: TranslateFormatResult
): TranslateFormatResult {
  const tencentResult = tencentTypeResult.result as TencentTranslateResult;
  if (tencentResult) {
    const tencentTranslation = tencentResult.TargetText;
    formatResult.translationItems.push({
      type: TranslationType.Tencent,
      text: tencentTranslation,
    });
    return sortTranslationItems(formatResult, sortedOrder);
  }
  return formatResult;
}

/**
 * update format result with caiyun translate result
 */
export function updateFormatResultWithCaiyunTranslation(
  caiyunTypeResult: RequestTypeResult,
  formatResult: TranslateFormatResult
): TranslateFormatResult {
  const caiyunResult = caiyunTypeResult.result as CaiyunTranslateResult;
  if (caiyunResult) {
    formatResult.translationItems.push({
      type: TranslationType.Caiyun,
      text: caiyunResult?.target.join("\n"),
    });
    return sortTranslationItems(formatResult, sortedOrder);
  }
  return formatResult;
}

/**
 * Sort translation results by designated order.
 *
 * * NOTE: this function will be called many times, because translate results are async, so we need to sort every time.
 */
export function sortTranslationItems(
  formatResult: TranslateFormatResult,
  sortedOrder: string[]
): TranslateFormatResult {
  const sortTranslations: TranslateItem[] = [];
  for (const translationItem of formatResult.translationItems) {
    const index = sortedOrder.indexOf(translationItem.type.toString().toLowerCase());
    sortTranslations[index] = translationItem;
  }
  // filter undefined
  const translations = sortTranslations.filter((item) => item);
  formatResult.translationItems = translations;
  return formatResult;
}

/**
 * Get translation result order, defaulf is sorted by: deelp > apple > baidu > tencent > youdao > caiyun.
 * If user set the order manually, prioritize the order.
 */
export function getTranslationResultOrder(): string[] {
  const defaultTypeOrder = [
    TranslationType.DeepL,
    TranslationType.Apple,
    TranslationType.Baidu,
    TranslationType.Tencent,
    TranslationType.Youdao,
    TranslationType.Caiyun,
  ];

  const defaultOrder = defaultTypeOrder.map((type) => type.toString().toLowerCase());

  const userOrder: string[] = [];
  // * NOTE: user manually set the sort order may not be complete, or even tpye wrong name.
  const manualOrder = myPreferences.translationDisplayOrder.toLowerCase().split(","); // "Baidu,DeepL,Tencent"
  // console.log("manualOrder:", manualOrder);
  if (manualOrder.length > 0) {
    for (let translationName of manualOrder) {
      translationName = translationName.trim();
      // if the type name is in the default order, add it to user order, and remove it from defaultNameOrder.
      if (defaultOrder.includes(translationName)) {
        userOrder.push(translationName);
        defaultOrder.splice(defaultOrder.indexOf(translationName), 1);
      }
    }
  }
  // console.log("defaultNameOrder:", defaultOrder);
  // console.log("userOrder:", userOrder);
  const finalOrder = [...userOrder, ...defaultOrder];
  // console.log("finalOrder:", finalOrder);
  return finalOrder;
}

/**
 * Format translate results so that can be directly used for UI display.
 */
export function formatTranslateDisplayResult(formatResult: TranslateFormatResult | null): TranslateDisplayResult[] {
  const displayResult: Array<TranslateDisplayResult> = [];
  if (!formatResult) {
    return displayResult;
  }

  const showMultipleTranslations = checkIfShowMultipleTranslations(formatResult);

  for (const [i, translateItem] of formatResult.translationItems.entries()) {
    const sectionType = showMultipleTranslations ? translateItem.type : SectionType.Translation;

    let sectionTitle = SectionType.Translation.toString();
    let tooltip = `${translateItem.type.toString()} Translate`;

    // don't show tooltip when show multiple translations
    if (showMultipleTranslations) {
      sectionTitle = tooltip;
      tooltip = "";
    }

    const oneLineTranslation = translateItem.text.split("\n").join(" ");
    const phoneticText = formatResult.queryWordInfo.phonetic ? `[${formatResult.queryWordInfo.phonetic}]` : undefined;
    const isShowWordSubtitle = phoneticText || formatResult.queryWordInfo.examTypes;
    const wordSubtitle = isShowWordSubtitle ? formatResult.queryWordInfo.word : undefined;

    displayResult.push({
      type: sectionType,
      sectionTitle: sectionTitle,
      items: [
        {
          key: oneLineTranslation + i,
          title: ` ${oneLineTranslation}`,
          subtitle: wordSubtitle,
          tooltip: tooltip,
          copyText: oneLineTranslation,
          queryWordInfo: formatResult.queryWordInfo,
          phonetic: phoneticText,
          speech: formatResult.queryWordInfo.speech,
          examTypes: formatResult.queryWordInfo.examTypes,
          translationMarkdown: formatAllTypeTranslationToMarkdown(sectionType, formatResult),
        },
      ],
    });

    if (!checkIfShowMultipleTranslations) {
      break;
    }
  }

  let hasShowDetailsSectionTitle = false;
  const detailsSectionTitle = "Details";

  formatResult.explanations?.forEach((explanation, i) => {
    displayResult.push({
      type: SectionType.Explanations,
      sectionTitle: !hasShowDetailsSectionTitle ? detailsSectionTitle : undefined,
      items: [
        {
          key: explanation + i,
          title: explanation,
          queryWordInfo: formatResult.queryWordInfo,
          tooltip: SectionType.Explanations,
          copyText: explanation,
        },
      ],
    });

    hasShowDetailsSectionTitle = true;
  });

  const wfs = formatResult.forms?.map((wfItem) => {
    return wfItem.wf?.name + " " + wfItem.wf?.value;
  });

  // [ 复数 goods   比较级 better   最高级 best ]
  const wfsText = wfs?.join("   ") || "";
  if (wfsText.length) {
    displayResult.push({
      type: SectionType.Forms,
      sectionTitle: !hasShowDetailsSectionTitle ? detailsSectionTitle : undefined,
      items: [
        {
          key: wfsText,
          title: "",
          queryWordInfo: formatResult.queryWordInfo,
          tooltip: SectionType.Forms,
          subtitle: `[ ${wfsText} ]`,
          copyText: wfsText,
        },
      ],
    });

    hasShowDetailsSectionTitle = true;
  }

  if (formatResult.webTranslation) {
    const webResultKey = formatResult.webTranslation?.key;
    const webResultValue = formatResult.webTranslation.value.join("；");
    const copyText = `${webResultKey} ${webResultValue}`;
    displayResult.push({
      type: SectionType.WebTranslation,
      sectionTitle: !hasShowDetailsSectionTitle ? detailsSectionTitle : undefined,
      items: [
        {
          key: copyText,
          title: webResultKey,
          queryWordInfo: formatResult.queryWordInfo,
          tooltip: SectionType.WebTranslation,
          subtitle: webResultValue,
          copyText: copyText,
        },
      ],
    });

    hasShowDetailsSectionTitle = true;
  }

  formatResult.webPhrases?.forEach((phrase, i) => {
    const phraseKey = phrase.key;
    const phraseValue = phrase.value.join("；");
    const copyText = `${phraseKey} ${phraseValue}`;
    displayResult.push({
      type: SectionType.WebPhrase,
      sectionTitle: !hasShowDetailsSectionTitle ? detailsSectionTitle : undefined,
      items: [
        {
          key: copyText + i,
          title: phraseKey,
          queryWordInfo: formatResult.queryWordInfo,
          tooltip: SectionType.WebPhrase,
          subtitle: phraseValue,
          copyText: copyText,
        },
      ],
    });

    hasShowDetailsSectionTitle = true;
  });

  return displayResult;
}

/**
 * Convert multiple translated result texts to markdown format and display them in the same list details page.
 */
export function formatAllTypeTranslationToMarkdown(
  type: TranslationType | SectionType,
  formatResult: TranslateFormatResult
) {
  const translations = [] as TranslateItem[];
  for (const translation of formatResult.translationItems) {
    const formatTranslation = formatTranslationToMarkdown(translation.type, translation.text);
    translations.push({ type: translation.type, text: formatTranslation });
  }
  // Traverse the translations array. If the type of translation element is equal to it, move it to the first of the array.
  for (let i = 0; i < translations.length; i++) {
    if (translations[i].type === type) {
      const temp = translations[i];
      translations.splice(i, 1);
      translations.unshift(temp);
      break;
    }
  }
  return translations
    .map((translation) => {
      return translation.text;
    })
    .join("\n");
}

/**
 *  format type translation result to markdown format.
 */
export function formatTranslationToMarkdown(type: TranslationType | SectionType, text: string) {
  const string = text.replace(/\n/g, "\n\n");
  const markdown = `
  ## ${type}
  ---  
  ${string}
  `;
  return markdown;
}
