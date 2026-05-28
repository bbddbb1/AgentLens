import { getAgentColor } from '@/lib/agentColors';
import { Bot, User, Shield, Brain, Search, Pencil, Wrench, Zap } from 'lucide-react';

const roleIcons: Record<string, React.ReactNode> = {
  planner: <Brain size={16} />,
  researcher: <Search size={16} />,
  critic: <Shield size={16} />,
  writer: <Pencil size={16} />,
  executor: <Zap size={16} />,
  reviewer: <Shield size={16} />,
  tool_user: <Wrench size={16} />,
};

interface AgentAvatarProps {
  agentId: string;
  role?: string;
  isHuman?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AgentAvatar({ agentId, role = 'agent', isHuman = false, size = 'md', className = '' }: AgentAvatarProps) {
  const color = getAgentColor(agentId);
  const Icon = isHuman ? <User size={16} /> : (roleIcons[role] || <Bot size={16} />);
  
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  };

  return (
    <div
      className={`flex items-center justify-center rounded-lg ${sizeClasses[size]} ${className}`}
      style={{ background: `${color}22`, color }}
      title={agentId}
    >
      {Icon}
    </div>
  );
}
