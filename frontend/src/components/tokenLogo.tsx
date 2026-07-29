import { Avatar } from "@mui/material";
import { FILE_ENDPOINT } from "@/config";

export default function TokenLogo({ logo, size, style, onClick }: { logo: string; size?: string | number; style?: any; onClick?: () => void }) {
    // If logo is already a full URL (starts with http:// or https://), use it directly
    // Otherwise, prepend FILE_ENDPOINT for relative paths
    const logoSrc = !logo ? undefined : logo.startsWith('http') ? logo : `${FILE_ENDPOINT}/${logo}`;

    return (
        <Avatar
            src={logoSrc}
            onClick={onClick}
            sx={{
                width: size ?? '120px',
                height: size ?? '120px',
                borderRadius: "12px",
                objectFit: 'cover',
                ...(onClick ? { cursor: 'pointer' } : {}),
                ...style,
            }}
        />
    );
}
