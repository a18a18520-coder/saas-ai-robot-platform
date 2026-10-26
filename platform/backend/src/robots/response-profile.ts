import { Robot } from './robot.entity';

/** Per-request presentation preferences; never changes evidence or tool authority. */
export function responseProfile(config: Robot['ragConfig'] = {}) {
  const fields = [
    ['客服性格', config.personality], ['表达语气', config.tone], ['客户可见回复格式', config.responseFormat],
  ].filter(([, value]) => typeof value === 'string' && value.trim());
  if (!fields.length) return '';
  return '\n租户为当前机器人配置的表达要求：\n' + fields.map(([label, value]) => `${label}：${value!.trim()}`).join('\n')
    + '\n这些要求仅调整措辞和客户可见内容的组织方式，不得改变授权知识事实、引用、工具权限和当前会话边界。保持接口要求的 JSON 结构，在答案文本字段中体现表达要求；严格原文引文不得改写。无需为体现性格添加寒暄、重复问题或无关内容。';
}
