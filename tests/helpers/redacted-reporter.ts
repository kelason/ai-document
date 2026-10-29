import type {Reporter,TestCase,TestResult,FullResult} from '@playwright/test/reporter';
function redact(value:string){return value.replace(/(token_hash|access_token|refresh_token|code|csrfToken)([=:"%\s]+)[^\s&"<>]+/gi,'$1$2[REDACTED]');}
export default class RedactedReporter implements Reporter{
 onTestEnd(test:TestCase,result:TestResult){console.log(`${result.status}: ${test.titlePath().join(' > ')}`);for(const error of result.errors)console.log(redact(error.message??'Test failed'));}
 onEnd(result:FullResult){console.log(`Browser suite: ${result.status}`);}
}
