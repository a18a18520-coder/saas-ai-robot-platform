/** Short factual questions need a direct conclusion, even when recall includes a whole chapter. */
export function isDirectFactQuestion(question: string): boolean {
  return /(是谁|叫什么|叫什么名字|名字是什么|名称是什么|叫什么游戏)/.test(question)
    && !/(详细|介绍|经历|背景|为什么|分析|概述|总结|分别|以及|并且)/.test(question);
}

export const DIRECT_FACT_STYLE = '回答长度规则：当前是单一事实问题，只输出一个 points 元素，text 用一句自然中文直接回答，最多160字。可补充原文已确认的作品、游戏等必要定位信息；不得列举证明过程、人物经历、职业、评级或无关情节。引用和证据仍放在 citations 中。第一人称叙述者的注册姓名与后文称呼相互印证时，可以直接给出角色姓名，无需复述推断过程。';

export function requestsDetail(question: string): boolean {
  return /详细|展开|逐步|逐条|全面分析|完整过程/.test(question);
}

export function requestsSources(question: string): boolean {
  return /来源|出处|引用|原文|依据/.test(question);
}

export function isPeopleListQuestion(question: string): boolean {
  return !requestsDetail(question) && /有哪些人|有哪些.*(?:人物|角色)|(?:人物|角色|人)有哪些/.test(question);
}

export const PEOPLE_LIST_STYLE = '当前只询问人物名单。必须只输出一个 points 元素，text 用一个短句列出人物名称（用顿号连接），有必要时加不超过六字的身份。不叙述职业选择、动作、对白、经历、评价或出场情节。先列原文明示姓名的人物，再简要补充未具名人物的身份；组织名、木牌上的字、所属阵营不等于人物姓名，不得单独作为一个人列出。同一个人的姓名和身份称呼不能重复列为两个人。citations 可以包含多条证据以支持完整名单。';

export const CONCISE_ANSWER_STYLE = '默认简洁回答：先直接给结论。只输出一至三句或至多三个短要点，正文合计不超过220字。问有哪些人/项目时只列完整名称和必要身份，不逐人讲经历；章节概述只概括主要事件。保留影响答案的条件、例外及用户要求的全部项目，不为缩短而改变事实。不要复述问题、证明过程或重复证据。详细内容仅在用户明确要求详细或展开时提供。引用证据仅放在 citations 字段中。';

export function validateAnswerStyle(raw: string, question: string): void {
  if (requestsDetail(question) || !isDirectFactQuestion(question) || !/(主角|主人公)是?谁/.test(question)) return;
  const data = JSON.parse(raw);
  if (data.sufficient !== true || !Array.isArray(data.points)) return;
  if (data.points.some((p: { text?: string }) => /注册|输入|确认|选择|评级|职业|经历|第一人称|试炼/.test(p.text ?? ''))) {
    throw new Error('身份问题只需“作品名中，在游戏名中的主角是姓名。”，可省略不确定的作品和游戏名；请删除注册、职业、评级和其他情节，只保留主角姓名这一结论');
  }
}
