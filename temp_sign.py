from PIL import Image, ImageDraw, ImageFont

img = Image.new("RGB", (900, 500), "white")
d = ImageDraw.Draw(img)
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 64)
d.text((40, 80), "CENTRAL LIBRARY", fill="black", font=font)
d.text((40, 190), "Floor 2 - Reading Room", fill="black", font=font)
d.text((40, 310), "Open 8:00 AM to 8:00 PM", fill="black", font=font)
img.save("temp-sign.jpg", quality=85)
print("ok")
