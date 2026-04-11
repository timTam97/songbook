import re

SONGBOOK = 'melbourne-songs.tex'

with open(SONGBOOK, 'r') as f:
    content = f.read()

# Find first active \begin{song} (not commented out)
first_song = re.search(r'^\\begin\{song\}', content, re.MULTILINE)
if not first_song:
    print("No songs found.")
    exit(1)

last_end_song = content.rfind(r'\end{song}')
end_tag = r'\end{song}'

preamble = content[:first_song.start()]
songs_region = content[first_song.start():last_end_song + len(end_tag)]
footer = content[last_end_song + len(end_tag):]

# Split into individual song blocks (each from \begin{song} to \end{song})
song_blocks = re.split(r'(?=\\begin\{song\})', songs_region)
song_blocks = [b for b in song_blocks if b.strip().startswith(r'\begin{song}')]

def get_title(block):
    m = re.match(r'\\begin\{song\}\{([^}]*)\}', block)
    return m.group(1).lower() if m else ''

song_blocks.sort(key=get_title)

result = preamble + '\n'.join(song_blocks) + footer

with open(SONGBOOK, 'w') as f:
    f.write(result)

print(f"Sorted {len(song_blocks)} songs alphabetically.")
print(f"  First: {get_title(song_blocks[0])}")
print(f"  Last:  {get_title(song_blocks[-1])}")
