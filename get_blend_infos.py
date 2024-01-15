import os
import bpy
import json

def get_infos():
  dictionary = {
    "extension": str(bpy.context.scene.render.file_extension),
    "start": bpy.context.scene.frame_start,
    "end": bpy.context.scene.frame_end,
    "step": bpy.context.scene.frame_step,
    "rate": bpy.context.scene.render.fps
  }
  print(dictionary)

get_infos()

#blender -b inputs/scene.blend --python get_blender_infos.py