'use client';
import { useRouter } from 'next/navigation';
export default function PrepPage() {
  const router = useRouter();
  return (
    <div style={{
      minHeight:'100vh', background:'#F7F3EC',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      padding:'0 32px', fontFamily:"'DM Sans', sans-serif",
    }}>
      <p style={{
        fontFamily:"'Cormorant Garamond', serif",
        fontSize:26, fontWeight:300, color:'#1A1410',
        marginBottom:8, textAlign:'center',
      }}>Prep Me</p>
      <p style={{
        fontSize:13, fontWeight:300, color:'rgba(26,20,16,0.44)',
        textAlign:'center', marginBottom:28, lineHeight:1.6,
      }}>
        AI-powered meeting prep coming in Session 11.
      </p>
      <button onClick={() => router.back()} style={{
        background:'transparent', border:'0.5px solid rgba(26,20,16,0.2)',
        borderRadius:12, padding:'11px 24px', cursor:'pointer',
        fontSize:11, fontWeight:700, letterSpacing:'2px',
        textTransform:'uppercase', color:'rgba(26,20,16,0.44)',
        fontFamily:"'DM Sans', sans-serif",
      }}>← Back</button>
    </div>
  );
}
