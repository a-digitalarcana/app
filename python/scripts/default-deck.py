#!/usr/bin/env python
# coding: utf-8

# In[2]:


import os

from PIL import Image               # to load images
from IPython.display import display # to display images

root = "C:\\dev\\da\\decks"
path = os.path.join(root,"nftarotcompiledwback.png")
deck = os.path.join(root,"default")
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

card_size = ((image.width/cards_in_suit), image.height/(num_suits+2))
print(card_size)

display_size = (int(card_size[0] * display_scale), int(card_size[1] * display_scale))
print(display_size)


# In[3]:


if not os.path.exists(deck):
    os.mkdir(deck)

def export(name,x,y):
    box = (x,y,x+card_size[0],y+card_size[1])
    card = image.crop(box)
    display(card)
    print(name)
    path = os.path.join(deck, name + ".png")
    card.save(path)

    # also save a scaled up version for display
    path = os.path.join(deck, name + "-display.png")
    card = card.resize(display_size, Image.NEAREST)
    card.save(path)
    display(card)

num_major_arcana = len(major_arcana)
back = export("back", (num_major_arcana%cards_in_suit) * card_size[0], (num_suits + 1) * card_size[1])
blank = export("blank", (1+num_major_arcana%cards_in_suit) * card_size[0], (num_suits + 1) * card_size[1])

for j in range(0,num_suits):
    for i in range(0,cards_in_suit):
        export(names[i] + "_of_" + suits[j], i * card_size[0], j * card_size[1])

for i in range(0,num_major_arcana):
    j = num_suits if i < cards_in_suit else num_suits + 1
    export(major_arcana[i], (i%cards_in_suit) * card_size[0], j * card_size[1])


# In[ ]:




