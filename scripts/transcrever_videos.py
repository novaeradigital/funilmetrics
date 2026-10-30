from pathlib import Path
from faster_whisper import WhisperModel


BASE = Path(__file__).resolve().parents[1]
INPUT_DIR = BASE / "materiais" / "videos-low-ticket"
OUTPUT_DIR = BASE / "materiais" / "transcricoes-low-ticket"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def timestamp(seconds: float) -> str:
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


model = WhisperModel("small", device="cpu", compute_type="int8")

for audio_path in sorted(INPUT_DIR.glob("*.webm")):
    output_path = OUTPUT_DIR / f"{audio_path.stem}.md"
    print(f"Transcrevendo {audio_path.name}...", flush=True)
    segments, info = model.transcribe(
        str(audio_path),
        language="pt",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    with output_path.open("w", encoding="utf-8") as output:
        output.write(f"# Transcrição — {audio_path.stem}\n\n")
        output.write(f"Idioma detectado: {info.language}\n\n")
        for segment in segments:
            text = segment.text.strip()
            if text:
                output.write(
                    f"[{timestamp(segment.start)}–{timestamp(segment.end)}] {text}\n\n"
                )
    print(f"Concluído: {output_path}", flush=True)
