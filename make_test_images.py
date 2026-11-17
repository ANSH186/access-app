from PIL import Image, ImageDraw, ImageFont

img = Image.new("RGB", (900, 500), "white")
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 64)
    small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 36)
except Exception:
    font = ImageFont.load_default()
    small = font
d.text((40, 80), "CENTRAL LIBRARY", fill="black", font=font)
d.text((40, 190), "Floor 2 - Reading Room", fill="black", font=font)
d.text((40, 310), "Open 8:00 AM to 8:00 PM", fill="black", font=small)
d.text((40, 370), "Silence please", fill="black", font=small)
img.save("sign-test.jpg", quality=85)

im = Image.open("data/sample-campus/lab_block_floors.png").convert("RGB")
im.thumbnail((1024, 1024))
im.save("floor-test.jpg", quality=70)
print(im.size)
