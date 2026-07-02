'use client'
import { Box, Typography, styled } from "@mui/material";

const Container = styled(Box)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  gap: 16px;
`;

const IconWrapper = styled(Box)`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(209, 255, 26, 0.06);
  border: 1px solid rgba(209, 255, 26, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
`;

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon = "🔍", title, description, action }: EmptyStateProps) {
  return (
    <Container>
      <IconWrapper>{icon}</IconWrapper>
      <Typography fontSize={18} fontWeight={600} color="white" fontFamily="'Space Grotesk', sans-serif">
        {title}
      </Typography>
      {description && (
        <Typography fontSize={14} color="#64748B" maxWidth={400}>
          {description}
        </Typography>
      )}
      {action}
    </Container>
  );
}
