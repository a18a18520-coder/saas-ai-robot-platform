import { Channel } from './channel.entity';

const FIELDS: Record<Channel['type'], readonly string[]> = {
  wecom: ['secret', 'token', 'aes_key'],
  dingtalk: ['app_secret', 'robot_code'],
  feishu: ['app_secret'],
  web: [],
};

export function channelSecretFields(type: Channel['type']): readonly string[] {
  return FIELDS[type] ?? [];
}
