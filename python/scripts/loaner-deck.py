#!/usr/bin/env python
# coding: utf-8

# In[58]:


import os

from PIL import Image, ImageOps     # to load images
from IPython.display import display # to display images

root = "C:\\dev\\da\\decks"
path = os.path.join(root,"nftarotcompiledwback.png")
simplePath = os.path.join(root,"supersimple.png")
deck = os.path.join(root,"loaner")
display_scale = 4;

suits = ["pentacles","swords","wands","cups"]
names = ["ace","two","three","four","five","six","seven","eight","nine","ten","page","knight","queen","king"]
major_arcana = ["the_fool","the_magician","high_priestess","the_empress","the_emperor","the_hierophant",
               "the_lovers","the_chariot","strength","the_hermit","wheel_of_fortune","justice",
               "hanged_man","death","temperance","the_devil","the_tower","the_star","the_moon","the_sun",
               "judgment","the_world"]

cards_in_suit = len(names)
num_suits = len(suits)

image = Image.open(path)
display(image)

simple = Image.open(simplePath)
display(simple)

card_size = (int(image.width/cards_in_suit), int(image.height/(num_suits+2)))
print(card_size)

display_size = (int(card_size[0] * display_scale), int(card_size[1] * display_scale))
print(display_size)


# In[57]:


if not os.path.exists(deck):
    os.mkdir(deck)

def shrink(size, x, y):
    return (x, y, size[0] - x, size[1] - y)
    
def export(name,x,y,top=1,bottom=15):
    box = (x,y,x+card_size[0],y+card_size[1])
    card = image.crop(box)
    card = card.crop((1, top, card_size[0] - 1, card_size[1] - bottom))
    back = simple.crop(box)
    print(name)
    back = back.resize(display_size, Image.NEAREST)
    offset = (display_scale + 1, display_scale + 1)
    back.paste(card, offset)
    card = ImageOps.mirror(card)
    offset = (card_size[0] * (display_scale - 1) - 3, display_scale + 1)
    back.paste(card, offset)
    display(back)
    
    path = os.path.join(deck, name + ".png")
    back.save(path)
    
num_major_arcana = len(major_arcana)

for j in range(0,num_suits):
    for i in range(0,cards_in_suit):
        export(names[i] + "_of_" + suits[j], i * card_size[0], j * card_size[1])

exceptions = ["the_magician","high_priestess","the_empress","the_emperor","the_hierophant",
             "wheel_of_fortune","hanged_man"]

for i in range(0,num_major_arcana):
    name = major_arcana[i]
    j = num_suits if i < cards_in_suit else num_suits + 1
    top = 6
    bottom = 14 if name in exceptions else 8
    export(name, (i%cards_in_suit) * card_size[0], j * card_size[1], top, bottom)


# In[ ]:




