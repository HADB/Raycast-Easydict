/*
 * @author: tisfeng
 * @createTime: 2022-06-24 17:07
 * @lastEditor: tisfeng
 * @lastEditTime: 2022-08-13 01:10
 * @fileName: detect.ts
 *
 * Copyright (c) 2022 by tisfeng, All Rights Reserved.
 */

import { isValidLanguageId } from "../language/languages";
import { myPreferences } from "../preferences";
import { appleLanguageDetect } from "../scripts";
import { requestBaiduLanguageDetect } from "../translation/baidu";
import { tencentLanguageDetect } from "../translation/tencent";
import { RequestErrorInfo } from "../types";
import { francDetectTextLangauge } from "./franc";
import { LanguageDetectType, LanguageDetectTypeResult } from "./types";
import {
  checkIfPreferredLanguagesContainedChinese,
  checkIfPreferredLanguagesContainedEnglish,
  isChinese,
  isEnglishOrNumber,
  isPreferredLanguage,
} from "./utils";

/**
 * * For a better user experience, a maximum of 2 seconds is set to request language detect API, and the local language check is used for timeout.
 *
 * If Apple language detection is enabled, both Apple language test and Tencent language test will be initiated, and which first-out result will be used.
 * If the language of the asynchronous check is the preferred language, use it directly. If not, continue to invoke local language detection.
 */
const delayDetectLanguageTime = 2000;
let isDetectedLanguage = false;
let delayLocalDetectLanguageTimer: NodeJS.Timeout;

/**
 * Record all API detected language, if has detected two identical language id, use it.
 */
const detectedAPILanguageTypeResultList: LanguageDetectTypeResult[] = [];

const defaultConfirmedConfidence = 0.8;

/**
 * Detect language with the given text, callback with LanguageDetectTypeResult.
 *
 * Prioritize the local language detection, then the language detection API.
 */
export function detectLanguage(
  text: string,
  callback: (detectedLanguageResult: LanguageDetectTypeResult) => void
): void {
  console.log(`start detectLanguage`);
  const localDetectResult = getLocalTextLanguageDetectResult(text, defaultConfirmedConfidence);
  if (localDetectResult.confirmed) {
    console.log("use local detect confirmed:", localDetectResult.type, localDetectResult.youdaoLanguageId);
    // Todo: may be do not need to clear timeout, when API detect success, callback once again.
    clearTimeout(delayLocalDetectLanguageTimer);
    callback(localDetectResult);
    return;
  }

  // Start a delay timer to detect local language, use it only if API detect over time.
  clearTimeout(delayLocalDetectLanguageTimer);
  delayLocalDetectLanguageTimer = setTimeout(() => {
    isDetectedLanguage = true;
    console.log(`API detect over time, use local detect language --->: ${localDetectResult}`);
    callback(localDetectResult);
  }, delayDetectLanguageTime);

  // covert the input text to lowercase, because Tencent LanguageDetect API is case sensitive, such as 'Section' is detected as 'fr' 😑
  const lowerCaseText = text.toLowerCase();
  console.log("detect queryText:", text);
  console.log("detect lowerCaseText:", lowerCaseText);

  // new a action map, key is LanguageDetectType, value is Promise<LanguageDetectTypeResult>
  const detectActionMap = new Map<LanguageDetectType, Promise<LanguageDetectTypeResult>>();
  detectActionMap.set(LanguageDetectType.Tencent, tencentLanguageDetect(lowerCaseText));
  if (myPreferences.enableAppleLanguageDetect) {
    detectActionMap.set(LanguageDetectType.Apple, appleLanguageDetect(lowerCaseText));
  }
  detectActionMap.set(LanguageDetectType.Baidu, requestBaiduLanguageDetect(lowerCaseText));

  // if local detect language is not confirmed, use API language detect
  try {
    raceDetectTextLanguage(detectActionMap, localDetectResult, (detectTypeResult) => {
      const finalLanguageTypeResult = getFinalLanguageDetectResult(text, detectTypeResult, defaultConfirmedConfidence);
      callback(finalLanguageTypeResult);
    });
  } catch (error) {
    // ? Never to enter here
    // if API detect error, use local detect language
    console.error(`detect language error: ${error}`);
    callback(localDetectResult);
  }
}

/**
 * Promise race to detect language, if success, callback API detect language, else local detect language
 *
 * Todo: may be don't need to use promise race, callback is ok.
 */
function raceDetectTextLanguage(
  detectLanguageActionMap: Map<LanguageDetectType, Promise<LanguageDetectTypeResult>>,
  localLanguageDetectTypeResult: LanguageDetectTypeResult,
  callback?: (detectTypeResult: LanguageDetectTypeResult) => void
) {
  console.log(`start raceDetectTextLanguage: ${[...detectLanguageActionMap.keys()]}`);
  // console.log("race local detect language: ", localLanguageDetectTypeResult);
  isDetectedLanguage = false;
  const detectLanguageActionList = detectLanguageActionMap.values();
  Promise.race(detectLanguageActionList)
    .then((typeResult) => {
      if (isDetectedLanguage) {
        console.warn(`promise race detect over time: ${JSON.stringify(typeResult, null, 4)}`);
        return;
      }

      isDetectedLanguage = true;
      clearTimeout(delayLocalDetectLanguageTimer);

      handleDetectedLanguageTypeResult(typeResult, localLanguageDetectTypeResult, detectLanguageActionMap, callback);
    })
    .catch((error) => {
      // If current API detect error, remove it from the detectActionMap, and try next detect API.
      console.error(`race detect language error: ${JSON.stringify(error, null, 4)}`); // error: {} ??
      console.log(`typeof error: ${typeof error}`);

      const errorInfo = error as RequestErrorInfo;
      const errorType = errorInfo.type as LanguageDetectType;
      if (Object.values(LanguageDetectType).includes(errorType)) {
        const detectTypeResult: LanguageDetectTypeResult = {
          type: errorType,
          sourceLanguageId: "",
          youdaoLanguageId: "",
          confirmed: false,
        };
        handleDetectedLanguageTypeResult(
          detectTypeResult,
          localLanguageDetectTypeResult,
          detectLanguageActionMap,
          callback
        );
      }
    });
}

function handleDetectedLanguageTypeResult(
  apiLanguageDetectTypeResult: LanguageDetectTypeResult,
  localLanguageDetectTypeResult: LanguageDetectTypeResult,
  detectLanguageActionMap: Map<LanguageDetectType, Promise<LanguageDetectTypeResult>>,
  callback?: (detectTypeResult: LanguageDetectTypeResult) => void
) {
  // First, check if the language is preferred language, if true, use it directly, else remove it from the action map.
  const checkIsPreferredLanguage = checkDetectedLanguageTypeResultIsPreferredAndIfNeedRemove(
    apiLanguageDetectTypeResult,
    detectLanguageActionMap
  );
  if (checkIsPreferredLanguage) {
    apiLanguageDetectTypeResult.confirmed = true;
    callback && callback(apiLanguageDetectTypeResult);
    return;
  }

  // Second, iterate detectedLanguageTypeList, check if has detected two identical language id, if true, use it.
  for (const languageTypeReuslt of detectedAPILanguageTypeResultList as LanguageDetectTypeResult[]) {
    const detectedYoudaoLanguageId = apiLanguageDetectTypeResult.youdaoLanguageId;
    if (
      languageTypeReuslt.youdaoLanguageId === detectedYoudaoLanguageId &&
      isValidLanguageId(detectedYoudaoLanguageId)
    ) {
      languageTypeReuslt.confirmed = true;
      console.warn(
        `---> API: ${languageTypeReuslt.type} -- ${
          apiLanguageDetectTypeResult.type
        }, detected identical language: ${JSON.stringify(languageTypeReuslt, null, 4)}`
      );
      callback && callback(languageTypeReuslt); // use the first detected language type, the speed of response is important.
      return;
    }
  }

  // If this API detected language is not confirmed, record it in the detectedLanguageTypeList.
  detectedAPILanguageTypeResultList.push(apiLanguageDetectTypeResult);

  /**
   * Finally, iterate API detectedLanguageTypeList, to compare with the local detect language list, if true, use it.
   * If matched, mark it as confirmed, else use it directly, but not confirmed.
   */
  if (detectLanguageActionMap.size === 0) {
    console.log(`try compare API detected language list with local deteced list`);
    console.log(`---> API detected language list: ${JSON.stringify(detectedAPILanguageTypeResultList, null, 4)}`);

    const detectedLocalLanguageArray = localLanguageDetectTypeResult.detectedLanguageArray;
    // console.log(`---> local detected language list: ${JSON.stringify(detectedLocalLanguageArray, null, 4)}`);
    if (detectedLocalLanguageArray?.length) {
      for (const [languageId, confidence] of detectedLocalLanguageArray) {
        // console.log(`---> local detected language: ${languageId}, confidence: ${confidence}`);
        for (const languageTypeReuslt of detectedAPILanguageTypeResultList) {
          // console.log(`---> API detected language: ${JSON.stringify(languageTypeReuslt, null, 4)}`);
          if (confidence > 0 && languageTypeReuslt.youdaoLanguageId === languageId && isValidLanguageId(languageId)) {
            languageTypeReuslt.confirmed = true;
            console.warn(`---> local detect identical language: ${JSON.stringify(languageTypeReuslt, null, 4)}`);
            callback && callback(languageTypeReuslt); // use the first detected language type, the speed of response is important.
            return;
          }
        }
      }
    }

    apiLanguageDetectTypeResult.confirmed = false;
    callback && callback(apiLanguageDetectTypeResult);
    return;
  }

  console.log(`---> continue to detect next action`);
  // if current action detect language has no result, continue to detect next action
  raceDetectTextLanguage(detectLanguageActionMap, localLanguageDetectTypeResult, callback);
}

/**
 * Check if the detected language type result is preferred language, if not, remove it from the action map.
 */
function checkDetectedLanguageTypeResultIsPreferredAndIfNeedRemove(
  detectTypeResult: LanguageDetectTypeResult,
  detectLanguageActionMap: Map<LanguageDetectType, Promise<LanguageDetectTypeResult>>
) {
  console.log(`---> check detected language type result: ${JSON.stringify(detectTypeResult, null, 4)}`);
  const youdaoLanguageId = detectTypeResult.youdaoLanguageId;
  if (youdaoLanguageId.length === 0 || !isPreferredLanguage(youdaoLanguageId)) {
    for (const [type] of detectLanguageActionMap) {
      if (type === detectTypeResult.type) {
        detectLanguageActionMap.delete(type);
      }
    }
    console.warn(`${detectTypeResult.type} check not preferred language: ${youdaoLanguageId}`);
    return false;
  }
  return true;
}

/**
 *  Get the final confirmed language type result, for handling some special case.
 *
 *  If detectTypeResult is confirmed, or is preferred language, use it directly, else use low confidence language.
 *
 *  This function is used when high confidence franc detect language is not confirmed, and API detect language catch error.
 */
function getFinalLanguageDetectResult(
  text: string,
  detectedTypeResult: LanguageDetectTypeResult,
  confirmedConfidence: number
): LanguageDetectTypeResult {
  console.log(`start try get final detect language: ${JSON.stringify(detectedTypeResult, null, 4)}`);
  if (detectedTypeResult.confirmed || isPreferredLanguage(detectedTypeResult.youdaoLanguageId)) {
    return detectedTypeResult;
  }
  return getLocalTextLanguageDetectResult(text, confirmedConfidence);
}

/**
 *  Get local detect language result.
 *  @highConfidence if local detect preferred language confidence > highConfidence, give priority to use it.
 *  * NOTE: Only preferred language confidence > highConfidence will mark as confirmed.
 *
 *  First, if franc detect language is confirmed, use it directly.
 *  Second, if detect preferred language confidence > lowConfidence, use it, but not confirmed.
 *  Third, if franc detect language is valid, use it, but not confirmed.
 *  Finally, if simple detect language is preferred language, use it. else use "auto".
 */
function getLocalTextLanguageDetectResult(
  text: string,
  confirmedConfidence: number,
  lowConfidence = 0.2
): LanguageDetectTypeResult {
  console.log(`start local detect language, confirmed confidence (>${confirmedConfidence})`);

  // if detect preferred language confidence > confirmedConfidence.
  const francDetectResult = francDetectTextLangauge(text, confirmedConfidence);
  if (francDetectResult.confirmed) {
    return francDetectResult;
  }

  // if detect preferred language confidence > lowConfidence, use it, mark it as unconfirmed.
  const detectedLanguageArray = francDetectResult.detectedLanguageArray;
  if (detectedLanguageArray) {
    for (const [languageId, confidence] of detectedLanguageArray) {
      if (confidence > lowConfidence && isPreferredLanguage(languageId)) {
        console.log(
          `franc detect preferred but unconfirmed language: ${languageId}, confidence: ${confidence} (>${lowConfidence})`
        );
        const lowConfidenceDetectTypeResult: LanguageDetectTypeResult = {
          type: francDetectResult.type,
          sourceLanguageId: francDetectResult.sourceLanguageId,
          youdaoLanguageId: languageId,
          confirmed: false,
          detectedLanguageArray: francDetectResult.detectedLanguageArray,
        };
        return lowConfidenceDetectTypeResult;
      }
    }
  }

  // if franc detect language is valid, use it, such as 'fr', 'it'.
  const youdaoLanguageId = francDetectResult.youdaoLanguageId;
  if (isValidLanguageId(youdaoLanguageId)) {
    console.log(`final use franc unconfirmed but valid detect: ${youdaoLanguageId}`);
    return francDetectResult;
  }

  // if simple detect is preferred language, use simple detect language('en', 'zh').
  const simpleDetectLangTypeResult = simpleDetectTextLanguage(text);
  if (isPreferredLanguage(simpleDetectLangTypeResult.youdaoLanguageId)) {
    console.log(`use simple detect: ${JSON.stringify(simpleDetectLangTypeResult, null, 4)}`);
    return simpleDetectLangTypeResult;
  }

  // finally, use "auto" as fallback.
  console.log(`final use auto`);
  const finalAutoLanguageTypeResult: LanguageDetectTypeResult = {
    type: LanguageDetectType.Simple,
    sourceLanguageId: "",
    youdaoLanguageId: "auto",
    confirmed: false,
  };
  return finalAutoLanguageTypeResult;
}

/**
 * Get simple detect language id according to text, priority to use English and Chinese, and then auto.
 *
 * * NOTE: simple detect language, always set confirmed = false.
 */
export function simpleDetectTextLanguage(text: string): LanguageDetectTypeResult {
  let fromYoudaoLanguageId = "auto";
  const englishLanguageId = "en";
  const chineseLanguageId = "zh-CHS";
  if (isEnglishOrNumber(text) && checkIfPreferredLanguagesContainedEnglish()) {
    fromYoudaoLanguageId = englishLanguageId;
  } else if (isChinese(text) && checkIfPreferredLanguagesContainedChinese()) {
    fromYoudaoLanguageId = chineseLanguageId;
  }
  console.log("simple detect language -->:", fromYoudaoLanguageId);
  const detectTypeResult = {
    type: LanguageDetectType.Simple,
    sourceLanguageId: fromYoudaoLanguageId,
    youdaoLanguageId: fromYoudaoLanguageId,
    confirmed: false,
  };
  return detectTypeResult;
}