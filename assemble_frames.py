import os
import bpy
import ntpath
from threading import Timer

def switch_to_vse_area():
    for area in bpy.context.window.screen.areas:
        area.type = 'SEQUENCE_EDITOR'
        break

def get_image_files(image_folder_path, image_extention=".png"):
    image_files = list()
    for file_name in os.listdir(image_folder_path):
        if file_name.endswith(image_extention):
            image_files.append(file_name)
    image_files.sort()
    print(image_files)
    return image_files

def set_up_output_params(image_folder_path):
    output_filename = ntpath.basename(bpy.data.filepath).removesuffix('.blend')
    filepath = os.path.join(image_folder_path, f"{output_filename}.mp4")
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.constant_rate_factor = "PERC_LOSSLESS"
    scene.render.filepath = filepath


switch_to_vse_area()

image_folder_path = os.path.dirname(bpy.data.filepath) + '/'

image_files = get_image_files(image_folder_path)
file_info = list()
for image_name in image_files:
    file_info.append({"name": image_name})

set_up_output_params(image_folder_path)

areas  = [area for area in bpy.context.window.screen.areas if area.type == 'SEQUENCE_EDITOR']

with bpy.context.temp_override(
    window=bpy.context.window,
    area=areas[0],
    regions=[region for region in areas[0].regions if region.type == 'WINDOW'][0],
    screen=bpy.context.window.screen
):
    bpy.ops.sequencer.image_strip_add(
        directory=image_folder_path,
        files=file_info,
        frame_start=1)

bpy.ops.render.render(animation=True)
