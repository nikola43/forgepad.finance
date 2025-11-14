import { Avatar } from "@mui/material";
import { FILE_ENDPOINT } from "@/config";

export default function TokenLogo({ logo, size, style }: { logo: string; size?: string | number; style?: any }) {
    // If logo is already a full URL (starts with http:// or https://), use it directly
    // Otherwise, prepend FILE_ENDPOINT for relative paths
    const logoSrc = logo?.startsWith('http') ? logo : `${FILE_ENDPOINT}/${logo}`;

    return (
        <Avatar
            src={logoSrc}
            sx={{
                width: size ?? '120px',
                height: size ?? '120px',
                borderRadius: "12px",
                objectFit: 'cover',
                ...style,
            }}
        />
    );
}
